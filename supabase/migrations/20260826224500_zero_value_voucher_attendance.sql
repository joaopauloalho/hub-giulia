-- Zero-value voucher / courtesy attendance support.
--
-- A service with final_price = 0 and no package coverage is a valid attendance:
-- it has no payment, but still records the procedure, clinical costs, materials,
-- inventory consumption and appointment completion atomically.

alter table public.procedures drop constraint procedures_payment_method_check;
alter table public.procedures add constraint procedures_payment_method_check
  check (payment_method in (
    'dinheiro',
    'cartao_credito',
    'cartao_debito',
    'pix',
    'pix_parcelado',
    'split',
    'package_credit',
    'cortesia'
  ));

-- Preserve the fully validated v4 implementation and wrap it only for the
-- zero-value/no-coverage/no-payment case. The synthetic zero payment exists
-- only inside the transaction so the legacy atomic implementation can be
-- reused safely; it is removed before the RPC returns and the procedure is
-- explicitly classified as `cortesia`.
alter function public.create_procedure_v4(
  uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb,text
) rename to create_procedure_v4_payment_required_legacy;

alter function public.create_procedure_with_injectable_draft_v4(
  uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,text,uuid,bigint
) rename to create_procedure_with_injectable_draft_v4_payment_required_legacy;

create or replace function public.create_procedure_v4(
  p_idempotency_key uuid,
  p_patient_id uuid,
  p_appointment_id uuid,
  p_performed_at timestamptz,
  p_items jsonb,
  p_payment_entries jsonb,
  p_injectable_maps jsonb,
  p_coverages jsonb,
  p_materials jsonb,
  p_notes text
) returns public.procedures
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_payments jsonb := coalesce(p_payment_entries, '[]'::jsonb);
  v_coverages jsonb := coalesce(p_coverages, '[]'::jsonb);
  v_no_charge boolean := false;
  v_result public.procedures;
  v_synthetic_payments jsonb := jsonb_build_array(jsonb_build_object(
    'method', 'dinheiro',
    'base_amount', 0,
    'amount', 0,
    'card_brand', null,
    'installments', 1,
    'fee_pct', null,
    'fee_value', null,
    'net_amount', 0,
    'absorve_taxa', true,
    'scheduled_date', null
  ));
begin
  if v_user_id is null then
    raise exception using errcode='P0001', message='ATTENDANCE_SESSION_REQUIRED';
  end if;
  if jsonb_typeof(v_payments) <> 'array' then
    raise exception using errcode='22023', message='ATTENDANCE_PAYMENTS_INVALID';
  end if;
  if jsonb_typeof(v_coverages) <> 'array' then
    raise exception using errcode='22023', message='ATTENDANCE_COVERAGES_INVALID';
  end if;

  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) = 'array'
     and jsonb_array_length(p_items) > 0
     and jsonb_array_length(v_payments) = 0
     and jsonb_array_length(v_coverages) = 0 then
    select round(coalesce(sum(item.final_price), 0), 2) = 0
      into v_no_charge
    from jsonb_to_recordset(p_items) as item(service_id uuid, qty numeric, final_price numeric);
  end if;

  if not v_no_charge then
    return public.create_procedure_v4_payment_required_legacy(
      p_idempotency_key,
      p_patient_id,
      p_appointment_id,
      p_performed_at,
      p_items,
      v_payments,
      coalesce(p_injectable_maps, '[]'::jsonb),
      v_coverages,
      coalesce(p_materials, '[]'::jsonb),
      p_notes
    );
  end if;

  select * into v_result
  from public.create_procedure_v4_payment_required_legacy(
    p_idempotency_key,
    p_patient_id,
    p_appointment_id,
    p_performed_at,
    p_items,
    v_synthetic_payments,
    coalesce(p_injectable_maps, '[]'::jsonb),
    v_coverages,
    coalesce(p_materials, '[]'::jsonb),
    p_notes
  );

  delete from public.procedure_payments
  where procedure_id = v_result.id
    and user_id = v_user_id
    and method = 'dinheiro'
    and amount = 0
    and net_amount = 0;

  update public.procedures
  set payment_method = 'cortesia'
  where id = v_result.id
    and user_id = v_user_id;

  select * into v_result
  from public.procedures
  where id = v_result.id
    and user_id = v_user_id;

  return v_result;
end;
$$;

create or replace function public.create_procedure_with_injectable_draft_v4(
  p_idempotency_key uuid,
  p_patient_id uuid,
  p_appointment_id uuid,
  p_performed_at timestamptz,
  p_items jsonb,
  p_payment_entries jsonb,
  p_coverages jsonb,
  p_materials jsonb,
  p_notes text,
  p_draft_id uuid,
  p_draft_revision bigint
) returns public.procedures
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_payments jsonb := coalesce(p_payment_entries, '[]'::jsonb);
  v_coverages jsonb := coalesce(p_coverages, '[]'::jsonb);
  v_no_charge boolean := false;
  v_result public.procedures;
  v_synthetic_payments jsonb := jsonb_build_array(jsonb_build_object(
    'method', 'dinheiro',
    'base_amount', 0,
    'amount', 0,
    'card_brand', null,
    'installments', 1,
    'fee_pct', null,
    'fee_value', null,
    'net_amount', 0,
    'absorve_taxa', true,
    'scheduled_date', null
  ));
begin
  if v_user_id is null then
    raise exception using errcode='P0001', message='ATTENDANCE_SESSION_REQUIRED';
  end if;
  if jsonb_typeof(v_payments) <> 'array' then
    raise exception using errcode='22023', message='ATTENDANCE_PAYMENTS_INVALID';
  end if;
  if jsonb_typeof(v_coverages) <> 'array' then
    raise exception using errcode='22023', message='ATTENDANCE_COVERAGES_INVALID';
  end if;

  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) = 'array'
     and jsonb_array_length(p_items) > 0
     and jsonb_array_length(v_payments) = 0
     and jsonb_array_length(v_coverages) = 0 then
    select round(coalesce(sum(item.final_price), 0), 2) = 0
      into v_no_charge
    from jsonb_to_recordset(p_items) as item(service_id uuid, qty numeric, final_price numeric);
  end if;

  if not v_no_charge then
    return public.create_procedure_with_injectable_draft_v4_payment_required_legacy(
      p_idempotency_key,
      p_patient_id,
      p_appointment_id,
      p_performed_at,
      p_items,
      v_payments,
      v_coverages,
      coalesce(p_materials, '[]'::jsonb),
      p_notes,
      p_draft_id,
      p_draft_revision
    );
  end if;

  select * into v_result
  from public.create_procedure_with_injectable_draft_v4_payment_required_legacy(
    p_idempotency_key,
    p_patient_id,
    p_appointment_id,
    p_performed_at,
    p_items,
    v_synthetic_payments,
    v_coverages,
    coalesce(p_materials, '[]'::jsonb),
    p_notes,
    p_draft_id,
    p_draft_revision
  );

  delete from public.procedure_payments
  where procedure_id = v_result.id
    and user_id = v_user_id
    and method = 'dinheiro'
    and amount = 0
    and net_amount = 0;

  update public.procedures
  set payment_method = 'cortesia'
  where id = v_result.id
    and user_id = v_user_id;

  select * into v_result
  from public.procedures
  where id = v_result.id
    and user_id = v_user_id;

  return v_result;
end;
$$;

revoke all on function public.create_procedure_v4(
  uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb,text
) from public, anon;
revoke all on function public.create_procedure_with_injectable_draft_v4(
  uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,text,uuid,bigint
) from public, anon;

grant execute on function public.create_procedure_v4(
  uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb,text
) to authenticated;
grant execute on function public.create_procedure_with_injectable_draft_v4(
  uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,text,uuid,bigint
) to authenticated;
