-- Hub Giulia — protocolos contratados diretamente no atendimento
-- Uma venda de combo/protocolo cria um tratamento ativo da paciente. As sessões
-- seguintes continuam sendo procedimentos normais cobertos pelos créditos do protocolo.

alter table public.patient_packages
  add column if not exists source_procedure_id uuid,
  add column if not exists source_catalog_service_id uuid,
  add column if not exists estimated_cost_snapshot numeric(14,2);

alter table public.patient_packages
  add constraint patient_packages_estimated_cost_check
  check (estimated_cost_snapshot is null or estimated_cost_snapshot >= 0);

alter table public.patient_packages
  add constraint patient_packages_source_procedure_owner_fkey
  foreign key (source_procedure_id, user_id)
  references public.procedures(id, user_id)
  on delete set null (source_procedure_id);

alter table public.patient_packages
  add constraint patient_packages_source_catalog_service_owner_fkey
  foreign key (source_catalog_service_id, user_id)
  references public.services(id, user_id)
  on delete set null (source_catalog_service_id);

create unique index patient_packages_attendance_protocol_uidx
  on public.patient_packages(user_id, source_procedure_id, source_catalog_service_id)
  where source_procedure_id is not null and source_catalog_service_id is not null;

create index patient_packages_source_catalog_service_idx
  on public.patient_packages(user_id, source_catalog_service_id)
  where source_catalog_service_id is not null;

create or replace function public.create_protocol_from_attendance_v1(
  p_procedure_id uuid,
  p_service_id uuid,
  p_commercial_value numeric,
  p_estimated_cost numeric default null,
  p_quantity numeric default 1
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
  v_package public.patient_packages;
  v_item public.patient_package_items;
  v_quantity numeric(12,3) := round(coalesce(p_quantity, 1), 3);
  v_value numeric(14,2) := round(greatest(coalesce(p_commercial_value, 0), 0), 2);
  v_estimated_cost numeric(14,2);
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'PROTOCOL_SESSION_REQUIRED';
  end if;
  if p_procedure_id is null or p_service_id is null then
    raise exception using errcode = '22023', message = 'PROTOCOL_SOURCE_REQUIRED';
  end if;
  if v_quantity <= 0 then
    raise exception using errcode = '22023', message = 'PROTOCOL_QUANTITY_INVALID';
  end if;
  if p_estimated_cost is not null and p_estimated_cost < 0 then
    raise exception using errcode = '22023', message = 'PROTOCOL_ESTIMATED_COST_INVALID';
  end if;

  select * into v_package
  from public.patient_packages
  where user_id = v_user_id
    and source_procedure_id = p_procedure_id
    and source_catalog_service_id = p_service_id;
  if found then return v_package; end if;

  select * into v_procedure
  from public.procedures
  where id = p_procedure_id and user_id = v_user_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'PROTOCOL_PROCEDURE_FORBIDDEN';
  end if;

  select * into v_service
  from public.services
  where id = p_service_id and user_id = v_user_id;
  if not found or v_service.type <> 'combo' then
    raise exception using errcode = 'P0001', message = 'PROTOCOL_COMBO_FORBIDDEN';
  end if;

  if not exists (
    select 1
    from public.procedure_items pi
    where pi.user_id = v_user_id
      and pi.procedure_id = v_procedure.id
      and pi.service_id = v_service.id
  ) then
    raise exception using errcode = 'P0001', message = 'PROTOCOL_COMBO_NOT_IN_ATTENDANCE';
  end if;

  -- Se o combo foi consumido por um pacote anterior, ele é uma sessão, não uma nova venda.
  if exists (
    select 1
    from public.package_redemptions r
    join public.procedure_items pi
      on pi.id = r.procedure_item_id_snapshot and pi.user_id = r.user_id
    where r.user_id = v_user_id
      and r.procedure_id_snapshot = v_procedure.id
      and pi.service_id = v_service.id
  ) then
    raise exception using errcode = 'P0001', message = 'PROTOCOL_ALREADY_COVERED';
  end if;

  v_estimated_cost := round(greatest(coalesce(p_estimated_cost, v_service.cost_per_unit, 0), 0) * v_quantity, 2);

  insert into public.patient_packages(
    user_id,
    patient_id,
    title_snapshot,
    source_type,
    status,
    commercial_total_snapshot,
    estimated_cost_snapshot,
    source_procedure_id,
    source_catalog_service_id,
    valid_from,
    activated_at,
    notes,
    creation_reason,
    created_by
  ) values (
    v_user_id,
    v_procedure.patient_id,
    v_service.name,
    case when v_value = 0 then 'complimentary' else 'manual' end,
    'draft',
    v_value,
    v_estimated_cost,
    v_procedure.id,
    v_service.id,
    v_procedure.performed_at::date,
    null,
    'Criado automaticamente a partir do atendimento ' || v_procedure.id::text,
    'Protocolo contratado no atendimento',
    v_user_id
  )
  returning * into v_package;

  if exists (
    select 1 from public.service_combo_items c
    where c.user_id = v_user_id and c.combo_service_id = v_service.id
  ) then
    insert into public.patient_package_items(
      user_id,
      package_id,
      service_id,
      service_name_snapshot,
      quantity_granted,
      unit_label_snapshot,
      commercial_value_snapshot,
      sort_order,
      source_combo_service_id,
      source_combo_name_snapshot
    )
    with components as (
      select
        c.component_service_id as service_id,
        s.name as service_name,
        round(v_quantity * c.quantity, 3) as granted_quantity,
        c.sort_order,
        greatest(coalesce(s.price, 0) * c.quantity, 0)::numeric as weight
      from public.service_combo_items c
      join public.services s
        on s.id = c.component_service_id and s.user_id = c.user_id
      where c.user_id = v_user_id
        and c.combo_service_id = v_service.id
    ), weighted as (
      select
        components.*,
        sum(weight) over() as total_weight,
        count(*) over() as component_count,
        row_number() over(order by sort_order, service_id) as component_number
      from components
    ), preliminary as (
      select
        weighted.*,
        case
          when total_weight > 0 then round(v_value * weight / total_weight, 2)
          else round(v_value / greatest(component_count, 1), 2)
        end as preliminary_value
      from weighted
    ), allocated as (
      select
        preliminary.*,
        case
          when component_number = component_count then
            round(
              v_value - coalesce(
                sum(preliminary_value) over(
                  order by sort_order, service_id
                  rows between unbounded preceding and 1 preceding
                ),
                0
              ),
              2
            )
          else preliminary_value
        end as allocated_value
      from preliminary
    )
    select
      v_user_id,
      v_package.id,
      a.service_id,
      a.service_name,
      a.granted_quantity,
      'sessão',
      greatest(a.allocated_value, 0),
      a.sort_order,
      v_service.id,
      v_service.name
    from allocated a
    order by a.sort_order, a.service_id;
  else
    insert into public.patient_package_items(
      user_id,
      package_id,
      service_id,
      service_name_snapshot,
      quantity_granted,
      unit_label_snapshot,
      commercial_value_snapshot,
      sort_order,
      source_combo_service_id,
      source_combo_name_snapshot
    ) values (
      v_user_id,
      v_package.id,
      v_service.id,
      v_service.name,
      v_quantity,
      'sessão',
      v_value,
      0,
      v_service.id,
      v_service.name
    );
  end if;

  for v_item in
    select *
    from public.patient_package_items
    where package_id = v_package.id and user_id = v_user_id
    order by sort_order, id
    for update
  loop
    insert into public.patient_credit_ledger(
      user_id,
      patient_id,
      package_id,
      package_item_id,
      movement_type,
      quantity_delta,
      source_type,
      source_id,
      reason,
      idempotency_key,
      created_by
    ) values (
      v_user_id,
      v_package.patient_id,
      v_package.id,
      v_item.id,
      'grant',
      v_item.quantity_granted,
      'activation',
      v_package.id,
      'Ativação inicial do protocolo',
      'activation:' || v_package.id::text || ':' || v_item.id::text,
      v_user_id
    ) on conflict (user_id, idempotency_key) do nothing;
  end loop;

  update public.patient_packages
  set status = 'active',
      activated_at = now(),
      activation_idempotency_key = coalesce(activation_idempotency_key, v_procedure.id),
      updated_at = now()
  where id = v_package.id and user_id = v_user_id
  returning * into v_package;

  return v_package;
exception
  when unique_violation then
    select * into v_package
    from public.patient_packages
    where user_id = v_user_id
      and source_procedure_id = p_procedure_id
      and source_catalog_service_id = p_service_id;
    if found then return v_package; end if;
    raise;
end;
$$;

revoke all on function public.create_protocol_from_attendance_v1(uuid, uuid, numeric, numeric, numeric) from public, anon;
grant execute on function public.create_protocol_from_attendance_v1(uuid, uuid, numeric, numeric, numeric) to authenticated;

comment on column public.patient_packages.estimated_cost_snapshot is
  'Custo total previsto do protocolo no momento da contratação. Não é custo realizado de uma sessão.';
comment on column public.patient_packages.source_procedure_id is
  'Atendimento no qual o protocolo foi contratado, quando criado por venda direta.';
comment on function public.create_protocol_from_attendance_v1(uuid, uuid, numeric, numeric, numeric) is
  'Cria e ativa, de forma idempotente, o protocolo comprado em um atendimento e expande a composição do combo em créditos de sessão.';