-- Fix clinical return registration without broad table grants.
-- The public return RPCs remain SECURITY INVOKER.
-- Protected writes are delegated only to narrowly scoped SECURITY DEFINER helpers.

create or replace function public.complete_procedure_returns_from_clinical_attendance_v1(
  p_return_procedure_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_return public.procedures;
begin
  if v_user_id is null then
    raise exception using errcode='P0001', message='ATTENDANCE_SESSION_REQUIRED';
  end if;

  select *
    into v_return
  from public.procedures
  where id = p_return_procedure_id
    and user_id = v_user_id
    and attendance_type = 'return'
    and parent_procedure_id is not null
  for update;

  if not found then
    raise exception using errcode='P0001', message='RETURN_PROCEDURE_FORBIDDEN';
  end if;

  update public.procedure_returns pr
  set completed_at = coalesce(pr.completed_at, now()),
      completed_by_procedure_id = coalesce(pr.completed_by_procedure_id, v_return.id),
      updated_at = now()
  where pr.user_id = v_user_id
    and pr.procedure_id = v_return.parent_procedure_id
    and pr.patient_id = v_return.patient_id
    and pr.dismissed_at is null
    and pr.completed_at is null
    and exists (
      select 1
      from public.procedure_items pi
      where pi.procedure_id = v_return.id
        and pi.user_id = v_user_id
        and pi.service_id = pr.service_id
    );
end;
$function$;

revoke all on function public.complete_procedure_returns_from_clinical_attendance_v1(uuid) from public, anon;
grant execute on function public.complete_procedure_returns_from_clinical_attendance_v1(uuid) to authenticated, service_role;

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
  v_zero_costs jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception using errcode='P0001', message='ATTENDANCE_SESSION_REQUIRED';
  end if;

  select *
    into v_parent
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

  select *
    into v_result
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

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'service_id', item ->> 'service_id',
        'cost', 0
      )
    ),
    '[]'::jsonb
  )
  into v_zero_costs
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) item;

  select *
    into v_result
  from public.set_procedure_item_costs_v1(v_result.id, v_zero_costs);

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

  perform public.complete_procedure_returns_from_clinical_attendance_v1(v_result.id);

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
  v_zero_costs jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception using errcode='P0001', message='ATTENDANCE_SESSION_REQUIRED';
  end if;

  select *
    into v_parent
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

  select *
    into v_result
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

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'service_id', item ->> 'service_id',
        'cost', 0
      )
    ),
    '[]'::jsonb
  )
  into v_zero_costs
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) item;

  select *
    into v_result
  from public.set_procedure_item_costs_v1(v_result.id, v_zero_costs);

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

  perform public.complete_procedure_returns_from_clinical_attendance_v1(v_result.id);

  return v_result;
end;
$function$;

revoke all on function public.create_clinical_return_v1(uuid,uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,integer,text) from public, anon;
grant execute on function public.create_clinical_return_v1(uuid,uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,integer,text) to authenticated, service_role;

revoke all on function public.create_clinical_return_with_injectable_draft_v1(uuid,uuid,uuid,uuid,timestamptz,jsonb,jsonb,integer,text,uuid,bigint) from public, anon;
grant execute on function public.create_clinical_return_with_injectable_draft_v1(uuid,uuid,uuid,uuid,timestamptz,jsonb,jsonb,integer,text,uuid,bigint) to authenticated, service_role;

notify pgrst, 'reload schema';
