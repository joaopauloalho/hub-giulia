-- Hub Giulia — retorno clínico como atendimento vinculado, sem nova cobrança

alter table public.procedures
  add column if not exists attendance_type text not null default 'procedure',
  add column if not exists parent_procedure_id uuid null;

alter table public.procedures
  drop constraint if exists procedures_attendance_type_check,
  add constraint procedures_attendance_type_check check (attendance_type in ('procedure', 'return')),
  drop constraint if exists procedures_return_parent_check,
  add constraint procedures_return_parent_check check (
    (attendance_type = 'procedure' and parent_procedure_id is null)
    or (attendance_type = 'return' and parent_procedure_id is not null)
  );

alter table public.procedures
  drop constraint if exists procedures_parent_procedure_fkey,
  add constraint procedures_parent_procedure_fkey
    foreign key (parent_procedure_id) references public.procedures(id) on delete restrict;

create index if not exists procedures_parent_procedure_idx
  on public.procedures(user_id, parent_procedure_id, performed_at desc)
  where parent_procedure_id is not null;

comment on column public.procedures.attendance_type is 'procedure = atendimento principal; return = retorno clínico sem nova cobrança, vinculado ao atendimento original.';
comment on column public.procedures.parent_procedure_id is 'Atendimento original ao qual este retorno clínico pertence.';

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
  where id = p_parent_procedure_id and user_id = v_user_id;

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
    select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) item
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
  where id = v_result.id and user_id = v_user_id
  returning * into v_result;

  update public.procedure_followups pf
  set completed_at = coalesce(pf.completed_at, now()),
      updated_at = now()
  where pf.user_id = v_user_id
    and pf.procedure_id = p_parent_procedure_id
    and pf.patient_id = p_patient_id
    and pf.dismissed_at is null
    and pf.return_type = 'clinical_return'
    and exists (
      select 1
      from public.procedure_items pi
      where pi.procedure_id = v_result.id
        and pi.user_id = v_user_id
        and pi.service_id = pf.service_id
    );

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
  where id = p_parent_procedure_id and user_id = v_user_id;

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
    select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) item
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
  where id = v_result.id and user_id = v_user_id
  returning * into v_result;

  update public.procedure_followups pf
  set completed_at = coalesce(pf.completed_at, now()),
      updated_at = now()
  where pf.user_id = v_user_id
    and pf.procedure_id = p_parent_procedure_id
    and pf.patient_id = p_patient_id
    and pf.dismissed_at is null
    and pf.return_type = 'clinical_return'
    and exists (
      select 1
      from public.procedure_items pi
      where pi.procedure_id = v_result.id
        and pi.user_id = v_user_id
        and pi.service_id = pf.service_id
    );

  return v_result;
end;
$function$;

revoke all on function public.create_clinical_return_v1(uuid,uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,integer,text) from public, anon;
grant execute on function public.create_clinical_return_v1(uuid,uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,integer,text) to authenticated;

revoke all on function public.create_clinical_return_with_injectable_draft_v1(uuid,uuid,uuid,uuid,timestamptz,jsonb,jsonb,integer,text,uuid,bigint) from public, anon;
grant execute on function public.create_clinical_return_with_injectable_draft_v1(uuid,uuid,uuid,uuid,timestamptz,jsonb,jsonb,integer,text,uuid,bigint) to authenticated;
