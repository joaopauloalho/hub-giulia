-- Depois que há sessões clínicas extras, o total contratado continua sendo a referência
-- comercial original. Editar nome/custo/previsão não deve obrigar a transformar extras em
-- sessões contratadas. Ainda impedimos reduzir o contratado abaixo do mínimo já preservado.

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
  v_minimum_total numeric(12,3);
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
  if v_package.clinically_finalized_at is not null then
    raise exception using errcode = 'P0001', message = 'PROTOCOL_CLINICALLY_FINALIZED';
  end if;

  select
    coalesce(sum(quantity_delta) filter (
      where movement_type = 'adjustment' and source_type <> 'protocol_clinical_extension'
    ), 0)::numeric(12,3),
    greatest(
      coalesce(-sum(quantity_delta) filter (where movement_type = 'redeem'), 0)
      - coalesce(sum(quantity_delta) filter (where movement_type = 'reversal'), 0),
      0
    )::numeric(12,3)
  into v_adjusted, v_completed
  from public.patient_credit_ledger
  where user_id = v_user_id and package_item_id = v_item.id;

  v_current_total := round(v_item.quantity_granted + v_adjusted, 3);
  v_minimum_total := least(v_completed, v_current_total);
  if v_target < v_minimum_total then
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
    user_id, patient_id, package_id, package_item_id,
    movement_type, quantity_delta, source_type, reason,
    idempotency_key, created_by
  ) values (
    v_user_id, v_package.patient_id, v_package.id, v_item.id,
    'adjustment', v_delta, 'protocol_plan_adjustment', btrim(p_reason),
    'protocol-total:' || p_idempotency_key::text, v_user_id
  );

  return v_target;
end;
$$;
