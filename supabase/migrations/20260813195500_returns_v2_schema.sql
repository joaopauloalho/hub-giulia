-- Hub Giulia 1.7 — Retornos 2.0
-- Schema only. No historical backfill is performed here.

-- Preserve legacy return_min_days / return_max_days values as-is.
-- Existing services remain disabled until the follow-up type is explicitly classified.
alter table public.services
  add column if not exists return_enabled boolean not null default false,
  add column if not exists return_type text;

alter table public.services
  add constraint services_return_type_check
  check (return_type is null or return_type in ('clinical_return', 'next_session'));

alter table public.services
  add constraint services_return_min_days_check
  check (return_min_days is null or return_min_days >= 0);

alter table public.services
  add constraint services_return_max_days_check
  check (return_max_days is null or return_max_days >= 0);

alter table public.services
  add constraint services_return_window_check
  check (
    return_min_days is null
    or return_max_days is null
    or return_max_days >= return_min_days
  );

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

create table public.procedure_returns (
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
  contact_method text,
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
  constraint procedure_returns_contact_method_check check (
    (contact_method is null or contact_method in ('whatsapp', 'phone', 'other'))
    and (contacted_at is not null or contact_method is null)
  ),
  constraint procedure_returns_terminal_state_check check (not (completed_at is not null and dismissed_at is not null))
);

alter table public.procedure_returns enable row level security;

create unique index procedure_returns_item_type_uidx
  on public.procedure_returns (user_id, procedure_item_id, return_type)
  where procedure_item_id is not null;

create index idx_procedure_returns_user_id
  on public.procedure_returns (user_id);
create index idx_procedure_returns_patient_id
  on public.procedure_returns (patient_id);
create index idx_procedure_returns_procedure_id
  on public.procedure_returns (procedure_id);
create index idx_procedure_returns_procedure_item_id
  on public.procedure_returns (procedure_item_id);
create index idx_procedure_returns_service_id
  on public.procedure_returns (service_id);
create index idx_procedure_returns_appointment_id
  on public.procedure_returns (appointment_id);
create index idx_procedure_returns_completed_by_procedure_id
  on public.procedure_returns (completed_by_procedure_id);
create index idx_procedure_returns_active_queue
  on public.procedure_returns (user_id, window_end, window_start)
  where completed_at is null and dismissed_at is null;
