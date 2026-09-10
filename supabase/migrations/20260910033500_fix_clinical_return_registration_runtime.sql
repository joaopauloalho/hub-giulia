-- Corrige o registro de retorno clínico em produção.
-- A versão inicial tentava atualizar public.procedure_followups, tabela que não existe
-- no schema atual, fazendo toda a transação do retorno sofrer rollback.

create or replace function public.create_clinical_return_v1(
  p_idempotency_key uuid,
  p_parent_procedure_id uuid,
  p_patient_id uuid,
  p_appointment_id uuid,
  p_performed_at timestamptz,
  p_items jsonb,
  p_injectable_maps jsonb,
  p_materials jsonb,
  p_clinical_minutes integer,
  p_notes text
)
returns public.procedures
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_parent public.procedures;
  v_result public.procedures;
begin
  if v_user_id is null then
    raise exception using errcode='P0001', message='ATTENDANCE_SESSION_REQUIRED';
  end if;

  select * into v_parent
  from public.procedures
  where id = p_parent_procedure_id
    and user_id = v_user_id;

  if not found then
    raise exception using errcode='P0001', message='RETURN_PARENT_FORBIDDEN';
  end if;

  if v_parent.patient_id <> p_patient_id then
    raise exception using errcode='P0001', message='RETURN_PATIENT_MISMATCH';
  end if;

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception using errcode='22023', message='RETURN_ITEM_REQUIRED';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) item
    where coalesce((item ->> 'final_price')::numeric, 0) <> 0
  ) then
    raise exception using errcode='22023', message='RETURN_MUST_BE_ZERO_VALUE';
  end if;

  select * into v_result
  from public.create_procedure_v5(
    p_idempotency_key,
    p_patient_id,
    p_appointment_id,
    p_performed_at,
    p_items,
    '[]'::jsonb,
    coalesce(p_injectable_maps, '[]'::jsonb),
    '[]'::jsonb,
    coalesce(p_materials, '[]'::jsonb),
    p_clinical_minutes,
    p_notes
  );

  update public.procedures
  set attendance_type = 'return',
      parent_procedure_id = p_parent_procedure_id,
      total_value = 0,
      net_value = 0,
      card_fee_pct = null,
      card_fee_value = null
  where id = v_result.id
    and user_id = v_user_id
  returning * into v_result;

  return v_result;
end;
$function$;

create or replace function public.create_clinical_return_with_injectable_draft_v1(
  p_idempotency_key uuid,
  p_parent_procedure_id uuid,
  p_patient_id uuid,
  p_appointment_id uuid,
  p_performed_at timestamptz,
  p_items jsonb,
  p_materials jsonb,
  p_clinical_minutes integer,
  p_notes text,
  p_draft_id uuid,
  p_draft_revision bigint
)
returns public.procedures
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_parent public.procedures;
  v_result public.procedures;
begin
  if v_user_id is null then
    raise exception using errcode='P0001', message='ATTENDANCE_SESSION_REQUIRED';
  end if;

  select * into v_parent
  from public.procedures
  where id = p_parent_procedure_id
    and user_id = v_user_id;

  if not found then
    raise exception using errcode='P0001', message='RETURN_PARENT_FORBIDDEN';
  end if;

  if v_parent.patient_id <> p_patient_id then
    raise exception using errcode='P0001', message='RETURN_PATIENT_MISMATCH';
  end if;

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception using errcode='22023', message='RETURN_ITEM_REQUIRED';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) item
    where coalesce((item ->> 'final_price')::numeric, 0) <> 0
  ) then
    raise exception using errcode='22023', message='RETURN_MUST_BE_ZERO_VALUE';
  end if;

  select * into v_result
  from public.create_procedure_with_injectable_draft_v5(
    p_idempotency_key,
    p_patient_id,
    p_appointment_id,
    p_performed_at,
    p_items,
    '[]'::jsonb,
    '[]'::jsonb,
    coalesce(p_materials, '[]'::jsonb),
    p_clinical_minutes,
    p_notes,
    p_draft_id,
    p_draft_revision
  );

  update public.procedures
  set attendance_type = 'return',
      parent_procedure_id = p_parent_procedure_id,
      total_value = 0,
      net_value = 0,
      card_fee_pct = null,
      card_fee_value = null
  where id = v_result.id
    and user_id = v_user_id
  returning * into v_result;

  return v_result;
end;
$function$;

notify pgrst, 'reload schema';
