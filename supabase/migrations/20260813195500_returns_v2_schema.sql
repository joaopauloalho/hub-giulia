-- Hub Giulia 1.7 — Retornos 2.0
-- Persistent, procedure-item scoped follow-up queue.

-- Existing return_min_days / return_max_days values are intentionally preserved.
-- Existing services remain disabled until their follow-up type is explicitly classified.
alter table public.services
  add column if not exists return_enabled boolean not null default false,
  add column if not exists return_type text;

alter table public.services
  drop constraint if exists services_return_type_check;
alter table public.services
  add constraint services_return_type_check
  check (return_type is null or return_type in ('clinical_return', 'next_session'));

alter table public.services
  drop constraint if exists services_return_min_days_check;
alter table public.services
  add constraint services_return_min_days_check
  check (return_min_days is null or return_min_days >= 0);

alter table public.services
  drop constraint if exists services_return_max_days_check;
alter table public.services
  add constraint services_return_max_days_check
  check (return_max_days is null or return_max_days >= 0);

alter table public.services
  drop constraint if exists services_return_window_check;
alter table public.services
  add constraint services_return_window_check
  check (
    return_min_days is null
    or return_max_days is null
    or return_max_days >= return_min_days
  );

alter table public.services
  drop constraint if exists services_return_enabled_rule_check;
alter table public.services
  add constraint services_return_enabled_rule_check
  check (
    not return_enabled
    or (
      return_type is not null
      and return_min_days is not null
      and return_max_days is not null
      and return_max_days >= return_min_days
    )
  );

create table if not exists public.procedure_returns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  patient_name_snapshot text not null,
  procedure_id uuid references public.procedures(id) on delete set null,
  procedure_item_id uuid references public.procedure_items(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  service_name_snapshot text not null,
  return_type text not null check (return_type in ('clinical_return', 'next_session')),
  procedure_date date not null,
  return_start_days integer not null check (return_start_days >= 0),
  return_end_days integer not null check (return_end_days >= return_start_days),
  window_start date not null,
  window_end date not null check (window_end >= window_start),
  contacted_at timestamptz,
  contact_method text check (contact_method is null or contact_method in ('whatsapp', 'phone', 'other')),
  appointment_id uuid references public.appointments(id) on delete set null,
  completed_at timestamptz,
  completed_by_procedure_id uuid references public.procedures(id) on delete set null,
  dismissed_at timestamptz,
  dismissed_reason text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint procedure_returns_patient_snapshot_check check (btrim(patient_name_snapshot) <> ''),
  constraint procedure_returns_service_snapshot_check check (btrim(service_name_snapshot) <> ''),
  constraint procedure_returns_contact_method_check check (contacted_at is not null or contact_method is null),
  constraint procedure_returns_terminal_state_check check (not (completed_at is not null and dismissed_at is not null))
);

create unique index if not exists procedure_returns_item_type_uidx
  on public.procedure_returns (user_id, procedure_item_id, return_type)
  where procedure_item_id is not null;

create index if not exists idx_procedure_returns_user_id
  on public.procedure_returns (user_id);
create index if not exists idx_procedure_returns_patient_id
  on public.procedure_returns (patient_id);
create index if not exists idx_procedure_returns_procedure_id
  on public.procedure_returns (procedure_id);
create index if not exists idx_procedure_returns_procedure_item_id
  on public.procedure_returns (procedure_item_id);
create index if not exists idx_procedure_returns_service_id
  on public.procedure_returns (service_id);
create index if not exists idx_procedure_returns_appointment_id
  on public.procedure_returns (appointment_id);
create index if not exists idx_procedure_returns_completed_by_procedure_id
  on public.procedure_returns (completed_by_procedure_id);
create index if not exists idx_procedure_returns_active_queue
  on public.procedure_returns (user_id, window_end, window_start)
  where completed_at is null and dismissed_at is null;

create or replace function public.touch_procedure_return_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.guard_procedure_return_history()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.user_id is distinct from old.user_id
     or new.patient_name_snapshot is distinct from old.patient_name_snapshot
     or new.service_name_snapshot is distinct from old.service_name_snapshot
     or new.return_type is distinct from old.return_type
     or new.procedure_date is distinct from old.procedure_date
     or new.return_start_days is distinct from old.return_start_days
     or new.return_end_days is distinct from old.return_end_days
     or new.window_start is distinct from old.window_start
     or new.window_end is distinct from old.window_end then
    raise exception using errcode = 'P0001', message = 'RETURN_HISTORY_IMMUTABLE';
  end if;

  -- Historical references may only be nulled by catalog/clinical record deletion.
  if new.patient_id is distinct from old.patient_id and new.patient_id is not null then
    raise exception using errcode = 'P0001', message = 'RETURN_PATIENT_IMMUTABLE';
  end if;
  if new.procedure_id is distinct from old.procedure_id and new.procedure_id is not null then
    raise exception using errcode = 'P0001', message = 'RETURN_PROCEDURE_IMMUTABLE';
  end if;
  if new.procedure_item_id is distinct from old.procedure_item_id and new.procedure_item_id is not null then
    raise exception using errcode = 'P0001', message = 'RETURN_PROCEDURE_ITEM_IMMUTABLE';
  end if;
  if new.service_id is distinct from old.service_id and new.service_id is not null then
    raise exception using errcode = 'P0001', message = 'RETURN_SERVICE_IMMUTABLE';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_procedure_returns_touch_updated_at on public.procedure_returns;
create trigger trg_procedure_returns_touch_updated_at
before update on public.procedure_returns
for each row execute function public.touch_procedure_return_updated_at();

drop trigger if exists trg_procedure_returns_guard_history on public.procedure_returns;
create trigger trg_procedure_returns_guard_history
before update on public.procedure_returns
for each row execute function public.guard_procedure_return_history();

alter table public.procedure_returns enable row level security;

drop policy if exists procedure_returns_select_own on public.procedure_returns;
create policy procedure_returns_select_own
on public.procedure_returns
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists procedure_returns_insert_own on public.procedure_returns;
create policy procedure_returns_insert_own
on public.procedure_returns
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and patient_id is not null
  and procedure_id is not null
  and procedure_item_id is not null
  and exists (
    select 1 from public.patients p
    where p.id = procedure_returns.patient_id
      and p.user_id = (select auth.uid())
  )
  and exists (
    select 1 from public.procedures p
    where p.id = procedure_returns.procedure_id
      and p.patient_id = procedure_returns.patient_id
      and p.user_id = (select auth.uid())
  )
  and exists (
    select 1 from public.procedure_items pi
    where pi.id = procedure_returns.procedure_item_id
      and pi.procedure_id = procedure_returns.procedure_id
      and pi.user_id = (select auth.uid())
  )
  and (
    service_id is null
    or exists (
      select 1 from public.services s
      where s.id = procedure_returns.service_id
        and s.user_id = (select auth.uid())
    )
  )
  and appointment_id is null
  and completed_by_procedure_id is null
);

drop policy if exists procedure_returns_update_own on public.procedure_returns;
create policy procedure_returns_update_own
on public.procedure_returns
for update
to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and (
    patient_id is null
    or exists (
      select 1 from public.patients p
      where p.id = procedure_returns.patient_id
        and p.user_id = (select auth.uid())
    )
  )
  and (
    procedure_id is null
    or exists (
      select 1 from public.procedures p
      where p.id = procedure_returns.procedure_id
        and p.user_id = (select auth.uid())
    )
  )
  and (
    procedure_item_id is null
    or exists (
      select 1 from public.procedure_items pi
      where pi.id = procedure_returns.procedure_item_id
        and pi.user_id = (select auth.uid())
    )
  )
  and (
    service_id is null
    or exists (
      select 1 from public.services s
      where s.id = procedure_returns.service_id
        and s.user_id = (select auth.uid())
    )
  )
  and (
    appointment_id is null
    or exists (
      select 1 from public.appointments a
      where a.id = procedure_returns.appointment_id
        and a.user_id = (select auth.uid())
        and (procedure_returns.patient_id is null or a.patient_id = procedure_returns.patient_id)
    )
  )
  and (
    completed_by_procedure_id is null
    or exists (
      select 1 from public.procedures p
      where p.id = procedure_returns.completed_by_procedure_id
        and p.user_id = (select auth.uid())
    )
  )
);

revoke all on table public.procedure_returns from anon;
grant select, insert, update on table public.procedure_returns to authenticated;

-- Explicit business operation for linking a return to an existing appointment.
create or replace function public.link_procedure_return_appointment(
  p_return_id uuid,
  p_appointment_id uuid
)
returns public.procedure_returns
language plpgsql
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_return public.procedure_returns;
  v_appointment public.appointments;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'RETURN_SESSION_REQUIRED';
  end if;

  select * into v_return
  from public.procedure_returns
  where id = p_return_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'RETURN_NOT_FOUND';
  end if;

  if v_return.completed_at is not null or v_return.dismissed_at is not null then
    raise exception using errcode = 'P0001', message = 'RETURN_ALREADY_CLOSED';
  end if;

  select * into v_appointment
  from public.appointments
  where id = p_appointment_id
    and user_id = v_user_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'RETURN_APPOINTMENT_NOT_FOUND';
  end if;

  if v_return.patient_id is null or v_appointment.patient_id <> v_return.patient_id then
    raise exception using errcode = 'P0001', message = 'RETURN_APPOINTMENT_PATIENT_MISMATCH';
  end if;

  if v_appointment.status not in ('pendente', 'confirmado') then
    raise exception using errcode = 'P0001', message = 'RETURN_APPOINTMENT_NOT_SCHEDULABLE';
  end if;

  update public.procedure_returns
  set appointment_id = p_appointment_id
  where id = p_return_id
    and user_id = v_user_id
  returning * into v_return;

  return v_return;
end;
$$;

revoke all on function public.link_procedure_return_appointment(uuid, uuid) from public;
grant execute on function public.link_procedure_return_appointment(uuid, uuid) to authenticated;

-- Retornos v2 wraps the proven Atomic Attendance v2 RPC instead of duplicating it.
-- The nested call is part of the same PostgreSQL transaction.
create or replace function public.create_procedure_v3(
  p_idempotency_key uuid,
  p_patient_id uuid,
  p_appointment_id uuid,
  p_performed_at timestamptz,
  p_items jsonb,
  p_payment_entries jsonb,
  p_injectable_maps jsonb,
  p_notes text
)
returns public.procedures
language plpgsql
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_existed_before boolean := false;
  v_proc public.procedures;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'ATTENDANCE_SESSION_REQUIRED';
  end if;

  select exists (
    select 1
    from public.procedures p
    where p.user_id = v_user_id
      and p.idempotency_key = p_idempotency_key
  ) into v_existed_before;

  v_proc := public.create_procedure_v2(
    p_idempotency_key,
    p_patient_id,
    p_appointment_id,
    p_performed_at,
    p_items,
    p_payment_entries,
    p_injectable_maps,
    p_notes
  );

  -- A successful previous v3 execution committed its returns in the same transaction.
  -- Existing v2 procedures are not retroactively reinterpreted on a later retry.
  if v_existed_before then
    return v_proc;
  end if;

  -- Completing a prior return requires the exact appointment link. A different visit
  -- by the same patient cannot close the return.
  if p_appointment_id is not null then
    update public.procedure_returns pr
    set
      completed_at = coalesce(pr.completed_at, now()),
      completed_by_procedure_id = coalesce(pr.completed_by_procedure_id, v_proc.id)
    where pr.user_id = v_user_id
      and pr.patient_id = p_patient_id
      and pr.appointment_id = p_appointment_id
      and pr.completed_at is null
      and pr.dismissed_at is null;
  end if;

  -- One persisted follow-up per procedure item and configured rule.
  insert into public.procedure_returns (
    user_id,
    patient_id,
    patient_name_snapshot,
    procedure_id,
    procedure_item_id,
    service_id,
    service_name_snapshot,
    return_type,
    procedure_date,
    return_start_days,
    return_end_days,
    window_start,
    window_end
  )
  select
    v_user_id,
    v_proc.patient_id,
    pat.name,
    v_proc.id,
    pi.id,
    pi.service_id,
    pi.name,
    s.return_type,
    (v_proc.performed_at at time zone 'America/Sao_Paulo')::date,
    s.return_min_days,
    s.return_max_days,
    (v_proc.performed_at at time zone 'America/Sao_Paulo')::date + s.return_min_days,
    (v_proc.performed_at at time zone 'America/Sao_Paulo')::date + s.return_max_days
  from public.procedure_items pi
  join public.services s
    on s.id = pi.service_id
   and s.user_id = v_user_id
  join public.patients pat
    on pat.id = v_proc.patient_id
   and pat.user_id = v_user_id
  where pi.procedure_id = v_proc.id
    and pi.user_id = v_user_id
    and s.return_enabled = true
  on conflict (user_id, procedure_item_id, return_type)
    where procedure_item_id is not null
  do nothing;

  return v_proc;
end;
$$;

revoke all on function public.create_procedure_v3(uuid, uuid, uuid, timestamptz, jsonb, jsonb, jsonb, text) from public;
grant execute on function public.create_procedure_v3(uuid, uuid, uuid, timestamptz, jsonb, jsonb, jsonb, text) to authenticated;
