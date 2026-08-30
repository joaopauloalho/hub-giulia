-- Hub Giulia — custo de tempo clínico v1
-- Mantém o valor da hora como configuração da clínica e congela o snapshot no atendimento.

create table if not exists public.clinic_cost_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  hourly_rate numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinic_cost_settings_hourly_rate_check check (hourly_rate >= 0 and hourly_rate <= 100000)
);

alter table public.clinic_cost_settings enable row level security;
revoke all on table public.clinic_cost_settings from anon, authenticated;
grant select, insert, update on table public.clinic_cost_settings to authenticated;

create policy clinic_cost_settings_select_own
  on public.clinic_cost_settings for select to authenticated
  using (user_id = (select auth.uid()));

create policy clinic_cost_settings_insert_own
  on public.clinic_cost_settings for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy clinic_cost_settings_update_own
  on public.clinic_cost_settings for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter table public.procedures
  add column if not exists clinical_minutes integer not null default 0,
  add column if not exists clinical_hourly_rate_snapshot numeric(12,2) not null default 0,
  add column if not exists clinical_time_cost numeric(14,2) not null default 0,
  add column if not exists clinical_cost_applied boolean not null default false;

alter table public.procedures
  drop constraint if exists procedures_clinical_minutes_check,
  add constraint procedures_clinical_minutes_check check (clinical_minutes between 0 and 1440),
  drop constraint if exists procedures_clinical_hourly_rate_snapshot_check,
  add constraint procedures_clinical_hourly_rate_snapshot_check check (clinical_hourly_rate_snapshot >= 0),
  drop constraint if exists procedures_clinical_time_cost_check,
  add constraint procedures_clinical_time_cost_check check (clinical_time_cost >= 0);

comment on column public.procedures.clinical_minutes is 'Tempo clínico efetivamente utilizado no atendimento, em minutos.';
comment on column public.procedures.clinical_hourly_rate_snapshot is 'Valor da hora clínica congelado no momento do atendimento.';
comment on column public.procedures.clinical_time_cost is 'Custo calculado do tempo clínico: minutos/60 × valor-hora snapshot.';

create or replace function public.create_procedure_v5(
  p_idempotency_key uuid,
  p_patient_id uuid,
  p_appointment_id uuid,
  p_performed_at timestamptz,
  p_items jsonb,
  p_payment_entries jsonb,
  p_injectable_maps jsonb,
  p_coverages jsonb,
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
  v_minutes integer := coalesce(p_clinical_minutes, 0);
  v_hourly_rate numeric(12,2) := 0;
  v_clinical_cost numeric(14,2) := 0;
  v_result public.procedures;
  v_locked public.procedures;
begin
  if v_user_id is null then
    raise exception using errcode='P0001', message='ATTENDANCE_SESSION_REQUIRED';
  end if;
  if v_minutes < 0 or v_minutes > 1440 then
    raise exception using errcode='22023', message='ATTENDANCE_CLINICAL_MINUTES_INVALID';
  end if;

  select * into v_result
  from public.create_procedure_v4(
    p_idempotency_key,
    p_patient_id,
    p_appointment_id,
    p_performed_at,
    p_items,
    coalesce(p_payment_entries, '[]'::jsonb),
    coalesce(p_injectable_maps, '[]'::jsonb),
    coalesce(p_coverages, '[]'::jsonb),
    coalesce(p_materials, '[]'::jsonb),
    p_notes
  );

  select * into v_locked
  from public.procedures
  where id = v_result.id and user_id = v_user_id
  for update;

  if not found then
    raise exception using errcode='P0001', message='ATTENDANCE_PROCEDURE_FORBIDDEN';
  end if;

  if v_locked.clinical_cost_applied then
    if v_locked.clinical_minutes <> v_minutes then
      raise exception using errcode='P0001', message='ATTENDANCE_IDEMPOTENCY_CONFLICT';
    end if;
    return v_locked;
  end if;

  select coalesce(s.hourly_rate, 0)
    into v_hourly_rate
  from public.clinic_cost_settings s
  where s.user_id = v_user_id;
  v_hourly_rate := coalesce(v_hourly_rate, 0);
  v_clinical_cost := round((v_minutes::numeric / 60) * v_hourly_rate, 2);

  update public.procedures
  set clinical_minutes = v_minutes,
      clinical_hourly_rate_snapshot = v_hourly_rate,
      clinical_time_cost = v_clinical_cost,
      clinical_cost_applied = true,
      total_cost = round(coalesce(total_cost, 0) + v_clinical_cost, 2)
  where id = v_locked.id and user_id = v_user_id
  returning * into v_result;

  return v_result;
end;
$function$;

create or replace function public.create_procedure_with_injectable_draft_v5(
  p_idempotency_key uuid,
  p_patient_id uuid,
  p_appointment_id uuid,
  p_performed_at timestamptz,
  p_items jsonb,
  p_payment_entries jsonb,
  p_coverages jsonb,
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
  v_minutes integer := coalesce(p_clinical_minutes, 0);
  v_hourly_rate numeric(12,2) := 0;
  v_clinical_cost numeric(14,2) := 0;
  v_result public.procedures;
  v_locked public.procedures;
begin
  if v_user_id is null then
    raise exception using errcode='P0001', message='ATTENDANCE_SESSION_REQUIRED';
  end if;
  if v_minutes < 0 or v_minutes > 1440 then
    raise exception using errcode='22023', message='ATTENDANCE_CLINICAL_MINUTES_INVALID';
  end if;

  select * into v_result
  from public.create_procedure_with_injectable_draft_v4(
    p_idempotency_key,
    p_patient_id,
    p_appointment_id,
    p_performed_at,
    p_items,
    coalesce(p_payment_entries, '[]'::jsonb),
    coalesce(p_coverages, '[]'::jsonb),
    coalesce(p_materials, '[]'::jsonb),
    p_notes,
    p_draft_id,
    p_draft_revision
  );

  select * into v_locked
  from public.procedures
  where id = v_result.id and user_id = v_user_id
  for update;

  if not found then
    raise exception using errcode='P0001', message='ATTENDANCE_PROCEDURE_FORBIDDEN';
  end if;

  if v_locked.clinical_cost_applied then
    if v_locked.clinical_minutes <> v_minutes then
      raise exception using errcode='P0001', message='ATTENDANCE_IDEMPOTENCY_CONFLICT';
    end if;
    return v_locked;
  end if;

  select coalesce(s.hourly_rate, 0)
    into v_hourly_rate
  from public.clinic_cost_settings s
  where s.user_id = v_user_id;
  v_hourly_rate := coalesce(v_hourly_rate, 0);
  v_clinical_cost := round((v_minutes::numeric / 60) * v_hourly_rate, 2);

  update public.procedures
  set clinical_minutes = v_minutes,
      clinical_hourly_rate_snapshot = v_hourly_rate,
      clinical_time_cost = v_clinical_cost,
      clinical_cost_applied = true,
      total_cost = round(coalesce(total_cost, 0) + v_clinical_cost, 2)
  where id = v_locked.id and user_id = v_user_id
  returning * into v_result;

  return v_result;
end;
$function$;

revoke all on function public.create_procedure_v5(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb,integer,text) from public, anon;
grant execute on function public.create_procedure_v5(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb,integer,text) to authenticated;

revoke all on function public.create_procedure_with_injectable_draft_v5(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,integer,text,uuid,bigint) from public, anon;
grant execute on function public.create_procedure_with_injectable_draft_v5(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,integer,text,uuid,bigint) to authenticated;
