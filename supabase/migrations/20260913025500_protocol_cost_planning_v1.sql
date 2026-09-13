-- Hub Giulia — planejamento financeiro editável de protocolos
-- Separa previsão de custo do protocolo de custo realizado nas sessões.

alter table public.patient_packages
  add column if not exists initial_estimated_cost_snapshot numeric(14,2);

alter table public.patient_packages
  drop constraint if exists patient_packages_initial_estimated_cost_check;

alter table public.patient_packages
  add constraint patient_packages_initial_estimated_cost_check
  check (initial_estimated_cost_snapshot is null or initial_estimated_cost_snapshot >= 0);

update public.patient_packages
set initial_estimated_cost_snapshot = estimated_cost_snapshot
where initial_estimated_cost_snapshot is null
  and estimated_cost_snapshot is not null;

comment on column public.patient_packages.initial_estimated_cost_snapshot is
  'Previsão de custo total congelada no início do protocolo. Não movimenta caixa e não é custo realizado.';
comment on column public.patient_packages.estimated_cost_snapshot is
  'Previsão atual editável do custo total do protocolo. Não movimenta caixa; o custo realizado vem dos atendimentos.';

create or replace function public.update_patient_protocol_plan_v1(
  p_package_id uuid,
  p_title text,
  p_valid_from date,
  p_estimated_cost numeric,
  p_notes text default null
)
returns public.patient_packages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_package public.patient_packages;
  v_cost numeric(14,2);
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'PROTOCOL_SESSION_REQUIRED';
  end if;
  if p_package_id is null then
    raise exception using errcode = '22023', message = 'PROTOCOL_REQUIRED';
  end if;
  if nullif(btrim(p_title), '') is null then
    raise exception using errcode = '22023', message = 'PROTOCOL_TITLE_REQUIRED';
  end if;
  if p_valid_from is null then
    raise exception using errcode = '22023', message = 'PROTOCOL_START_DATE_REQUIRED';
  end if;
  if p_estimated_cost is null or p_estimated_cost < 0 then
    raise exception using errcode = '22023', message = 'PROTOCOL_ESTIMATED_COST_INVALID';
  end if;

  v_cost := round(p_estimated_cost, 2);

  select * into v_package
  from public.patient_packages
  where id = p_package_id and user_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'PROTOCOL_FORBIDDEN';
  end if;
  if v_package.status = 'voided' then
    raise exception using errcode = 'P0001', message = 'PROTOCOL_VOIDED';
  end if;

  update public.patient_packages
  set title_snapshot = btrim(p_title),
      valid_from = p_valid_from,
      initial_estimated_cost_snapshot = coalesce(initial_estimated_cost_snapshot, estimated_cost_snapshot, v_cost),
      estimated_cost_snapshot = v_cost,
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      updated_at = now()
  where id = p_package_id and user_id = v_user_id
  returning * into v_package;

  return v_package;
end;
$$;

revoke all on function public.update_patient_protocol_plan_v1(uuid, text, date, numeric, text) from public, anon;
grant execute on function public.update_patient_protocol_plan_v1(uuid, text, date, numeric, text) to authenticated;

create or replace function public.set_patient_protocol_item_total_v1(
  p_package_item_id uuid,
  p_total numeric,
  p_reason text,
  p_idempotency_key uuid
)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_item public.patient_package_items;
  v_package public.patient_packages;
  v_adjusted numeric(12,3);
  v_completed numeric(12,3);
  v_current_total numeric(12,3);
  v_target numeric(12,3);
  v_delta numeric(12,3);
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'PROTOCOL_SESSION_REQUIRED';
  end if;
  if p_package_item_id is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'PROTOCOL_ITEM_REQUIRED';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'PROTOCOL_ADJUSTMENT_REASON_REQUIRED';
  end if;

  v_target := round(coalesce(p_total, 0), 3);
  if v_target <= 0 or v_target > 1000 then
    raise exception using errcode = '22023', message = 'PROTOCOL_TOTAL_INVALID';
  end if;

  select * into v_item
  from public.patient_package_items
  where id = p_package_item_id and user_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'PROTOCOL_ITEM_FORBIDDEN';
  end if;

  select * into v_package
  from public.patient_packages
  where id = v_item.package_id and user_id = v_user_id
  for update;
  if not found or v_package.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'PROTOCOL_NOT_ACTIVE';
  end if;

  select
    coalesce(sum(quantity_delta) filter (where movement_type = 'adjustment'), 0)::numeric(12,3),
    greatest(
      coalesce(-sum(quantity_delta) filter (where movement_type = 'redeem'), 0)
      - coalesce(sum(quantity_delta) filter (where movement_type = 'reversal'), 0),
      0
    )::numeric(12,3)
  into v_adjusted, v_completed
  from public.patient_credit_ledger
  where user_id = v_user_id and package_item_id = v_item.id;

  v_current_total := round(v_item.quantity_granted + v_adjusted, 3);
  if v_target < v_completed then
    raise exception using errcode = '22023', message = 'PROTOCOL_TOTAL_BELOW_COMPLETED';
  end if;

  v_delta := round(v_target - v_current_total, 3);
  if v_delta = 0 then
    return v_target;
  end if;

  if exists (
    select 1 from public.patient_credit_ledger
    where user_id = v_user_id
      and idempotency_key = 'protocol-total:' || p_idempotency_key::text
  ) then
    return v_target;
  end if;

  insert into public.patient_credit_ledger(
    user_id,
    patient_id,
    package_id,
    package_item_id,
    movement_type,
    quantity_delta,
    source_type,
    reason,
    idempotency_key,
    created_by
  ) values (
    v_user_id,
    v_package.patient_id,
    v_package.id,
    v_item.id,
    'adjustment',
    v_delta,
    'protocol_plan_adjustment',
    btrim(p_reason),
    'protocol-total:' || p_idempotency_key::text,
    v_user_id
  );

  return v_target;
end;
$$;

revoke all on function public.set_patient_protocol_item_total_v1(uuid, numeric, text, uuid) from public, anon;
grant execute on function public.set_patient_protocol_item_total_v1(uuid, numeric, text, uuid) to authenticated;

comment on function public.update_patient_protocol_plan_v1(uuid, text, date, numeric, text) is
  'Edita metadados e previsão atual do protocolo sem lançar custo no caixa.';
comment on function public.set_patient_protocol_item_total_v1(uuid, numeric, text, uuid) is
  'Define o total planejado de sessões/créditos de um item do protocolo sem permitir reduzir abaixo do já realizado.';
