-- Hub Giulia — vinculação segura de protocolos antigos
-- Permite transformar um atendimento histórico de combo/protocolo em protocolo ativo
-- sem duplicar cobrança e abatendo as sessões que já tinham sido realizadas.

create or replace view public.patient_legacy_protocol_candidates_v
with (security_invoker = true)
as
with combo_composition as (
  select
    c.user_id,
    c.combo_service_id,
    count(*)::integer as component_count,
    coalesce(sum(c.quantity), 0)::numeric(12,3) as planned_sessions
  from public.service_combo_items c
  group by c.user_id, c.combo_service_id
)
select
  pr.user_id,
  pr.patient_id,
  pr.id as procedure_id,
  pr.performed_at,
  pi.id as procedure_item_id,
  pi.service_id,
  pi.name as service_name_snapshot,
  pi.qty,
  pi.final_price,
  pi.cost_snapshot,
  s.cost_per_unit as catalog_estimated_cost,
  coalesce(cc.component_count, 0) as component_count,
  case when coalesce(cc.component_count, 0) > 0 then cc.planned_sessions else null end as planned_sessions
from public.procedures pr
join public.procedure_items pi
  on pi.procedure_id = pr.id
 and pi.user_id = pr.user_id
join public.services s
  on s.id = pi.service_id
 and s.user_id = pi.user_id
left join combo_composition cc
  on cc.user_id = s.user_id
 and cc.combo_service_id = s.id
where s.type = 'combo'
  and not exists (
    select 1
    from public.patient_packages pp
    where pp.user_id = pr.user_id
      and pp.source_procedure_id = pr.id
      and pp.source_catalog_service_id = s.id
  )
  and not exists (
    select 1
    from public.package_redemptions r
    where r.user_id = pr.user_id
      and r.procedure_item_id_snapshot = pi.id
  );

revoke all on public.patient_legacy_protocol_candidates_v from anon;
grant select on public.patient_legacy_protocol_candidates_v to authenticated;

create or replace function public.link_legacy_protocol_from_attendance_v1(
  p_procedure_id uuid,
  p_service_id uuid,
  p_total_sessions integer default null,
  p_completed_sessions integer default 1
)
returns public.patient_packages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_procedure public.procedures;
  v_service public.services;
  v_source_item public.procedure_items;
  v_package public.patient_packages;
  v_component_count integer := 0;
  v_composition_sessions numeric(12,3) := 0;
  v_protocol_quantity numeric(12,3);
  v_capacity numeric(12,3);
  v_completed numeric(12,3) := coalesce(p_completed_sessions, 0);
  v_already_completed numeric(12,3) := 0;
  v_remaining numeric(12,3);
  v_take numeric(12,3);
  v_cost_argument numeric;
  v_item record;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'LEGACY_PROTOCOL_SESSION_REQUIRED';
  end if;
  if p_procedure_id is null or p_service_id is null then
    raise exception using errcode = '22023', message = 'LEGACY_PROTOCOL_SOURCE_REQUIRED';
  end if;
  if p_completed_sessions is null or p_completed_sessions < 0 or p_completed_sessions > 1000 then
    raise exception using errcode = '22023', message = 'LEGACY_PROTOCOL_COMPLETED_INVALID';
  end if;

  select * into v_procedure
  from public.procedures
  where id = p_procedure_id and user_id = v_user_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'LEGACY_PROTOCOL_PROCEDURE_FORBIDDEN';
  end if;

  select * into v_service
  from public.services
  where id = p_service_id and user_id = v_user_id and type = 'combo';
  if not found then
    raise exception using errcode = 'P0001', message = 'LEGACY_PROTOCOL_COMBO_FORBIDDEN';
  end if;

  select * into v_source_item
  from public.procedure_items
  where user_id = v_user_id
    and procedure_id = v_procedure.id
    and service_id = v_service.id
  order by created_at, id
  limit 1;
  if not found then
    raise exception using errcode = 'P0001', message = 'LEGACY_PROTOCOL_COMBO_NOT_IN_ATTENDANCE';
  end if;

  select count(*)::integer, coalesce(sum(quantity), 0)::numeric(12,3)
  into v_component_count, v_composition_sessions
  from public.service_combo_items
  where user_id = v_user_id and combo_service_id = v_service.id;

  if v_component_count > 0 then
    v_protocol_quantity := greatest(coalesce(v_source_item.qty, 1), 1);
    v_capacity := round(v_composition_sessions * v_protocol_quantity, 3);
    v_cost_argument := greatest(coalesce(v_service.cost_per_unit, v_source_item.cost_snapshot, 0), 0);
  else
    if p_total_sessions is null or p_total_sessions < 1 or p_total_sessions > 1000 then
      raise exception using errcode = '22023', message = 'LEGACY_PROTOCOL_TOTAL_SESSIONS_REQUIRED';
    end if;
    v_protocol_quantity := p_total_sessions;
    v_capacity := p_total_sessions;
    -- create_protocol_from_attendance_v1 multiplica o custo pelo p_quantity.
    -- Para combos antigos sem composição, o custo cadastrado já representa o protocolo inteiro.
    v_cost_argument := greatest(coalesce(v_service.cost_per_unit, v_source_item.cost_snapshot, 0), 0) / v_protocol_quantity;
  end if;

  if v_completed > v_capacity then
    raise exception using errcode = '22023', message = 'LEGACY_PROTOCOL_COMPLETED_EXCEEDS_TOTAL';
  end if;

  select * into v_package
  from public.patient_packages
  where user_id = v_user_id
    and source_procedure_id = v_procedure.id
    and source_catalog_service_id = v_service.id;

  if not found then
    v_package := public.create_protocol_from_attendance_v1(
      v_procedure.id,
      v_service.id,
      greatest(coalesce(v_source_item.final_price, 0), 0),
      v_cost_argument,
      v_protocol_quantity
    );
  end if;

  select coalesce(-sum(l.quantity_delta), 0)::numeric(12,3)
  into v_already_completed
  from public.patient_credit_ledger l
  where l.user_id = v_user_id
    and l.package_id = v_package.id
    and l.source_type = 'legacy_protocol_link'
    and l.source_id = v_procedure.id
    and l.movement_type = 'redeem';

  if v_completed < v_already_completed then
    raise exception using errcode = 'P0001', message = 'LEGACY_PROTOCOL_COMPLETED_CANNOT_DECREASE';
  end if;

  v_remaining := round(v_completed - v_already_completed, 3);

  if v_remaining > 0 then
    for v_item in
      select
        i.id,
        i.sort_order,
        greatest(coalesce(sum(l.quantity_delta), 0), 0)::numeric(12,3) as available_balance
      from public.patient_package_items i
      left join public.patient_credit_ledger l
        on l.user_id = i.user_id
       and l.package_item_id = i.id
      where i.user_id = v_user_id
        and i.package_id = v_package.id
      group by i.id, i.sort_order
      order by i.sort_order, i.id
    loop
      exit when v_remaining <= 0;
      if v_item.available_balance <= 0 then continue; end if;
      v_take := least(v_remaining, v_item.available_balance);

      insert into public.patient_credit_ledger(
        user_id,
        patient_id,
        package_id,
        package_item_id,
        movement_type,
        quantity_delta,
        source_type,
        source_id,
        procedure_id_snapshot,
        procedure_item_id_snapshot,
        reason,
        idempotency_key,
        created_by
      ) values (
        v_user_id,
        v_package.patient_id,
        v_package.id,
        v_item.id,
        'redeem',
        -v_take,
        'legacy_protocol_link',
        v_procedure.id,
        v_procedure.id,
        v_source_item.id,
        'Sessão histórica realizada antes da vinculação do protocolo',
        'legacy-protocol-link:' || v_package.id::text || ':' || v_item.id::text || ':' || p_completed_sessions::text,
        v_user_id
      ) on conflict (user_id, idempotency_key) do nothing;

      v_remaining := round(v_remaining - v_take, 3);
    end loop;
  end if;

  if v_remaining > 0 then
    raise exception using errcode = 'P0001', message = 'LEGACY_PROTOCOL_INSUFFICIENT_BALANCE';
  end if;

  update public.patient_packages
  set notes = case
        when coalesce(notes, '') like '%Atendimento antigo vinculado ao protocolo.%' then notes
        else concat_ws(E'\n', nullif(notes, ''), 'Atendimento antigo vinculado ao protocolo.')
      end,
      updated_at = now()
  where id = v_package.id and user_id = v_user_id
  returning * into v_package;

  return v_package;
end;
$$;

revoke all on function public.link_legacy_protocol_from_attendance_v1(uuid, uuid, integer, integer) from public, anon;
grant execute on function public.link_legacy_protocol_from_attendance_v1(uuid, uuid, integer, integer) to authenticated;

comment on view public.patient_legacy_protocol_candidates_v is
  'Atendimentos históricos com combo ainda não vinculados a um protocolo ativo.';
comment on function public.link_legacy_protocol_from_attendance_v1(uuid, uuid, integer, integer) is
  'Converte de forma idempotente um atendimento antigo de combo em protocolo ativo e abate sessões históricas sem gerar nova cobrança.';
