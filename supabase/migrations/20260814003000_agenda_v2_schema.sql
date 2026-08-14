-- Hub Giulia 1.9 — Agenda 2.0: backward-compatible appointment schema.

alter table public.appointments
  add column if not exists duration_minutes integer,
  add column if not exists end_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists confirmed_at timestamptz,
  add column if not exists canceled_at timestamptz,
  add column if not exists cancellation_reason text,
  add column if not exists no_show_at timestamptz,
  add column if not exists source text not null default 'manual',
  add column if not exists google_sync_status text not null default 'pending',
  add column if not exists google_last_synced_at timestamptz,
  add column if not exists google_sync_error_code text,
  add column if not exists idempotency_key uuid;

update public.appointments a
set duration_minutes = coalesce(nullif(s.duration_minutes, 0), 60)
from public.services s
where a.service_id = s.id
  and a.user_id = s.user_id
  and a.duration_minutes is null;

update public.appointments
set duration_minutes = 60
where duration_minutes is null;

update public.appointments
set end_at = scheduled_at + make_interval(mins => duration_minutes)
where end_at is null;

update public.appointments
set google_sync_status = case when google_event_id is not null then 'synced' else 'pending' end,
    google_last_synced_at = case when google_event_id is not null then coalesce(updated_at, created_at) else null end;

alter table public.appointments
  alter column duration_minutes set not null,
  alter column end_at set not null;

alter table public.appointments
  drop constraint if exists appointments_status_check;

alter table public.appointments
  add constraint appointments_status_check
    check (status = any (array['pendente'::text, 'confirmado'::text, 'realizado'::text, 'cancelado'::text, 'nao_compareceu'::text])),
  add constraint appointments_duration_minutes_check
    check (duration_minutes > 0 and duration_minutes <= 1440),
  add constraint appointments_end_after_start_check
    check (end_at > scheduled_at),
  add constraint appointments_source_check
    check (source = any (array['manual'::text, 'return'::text])),
  add constraint appointments_google_sync_status_check
    check (google_sync_status = any (array['synced'::text, 'pending'::text, 'error'::text, 'disconnected'::text]));

create unique index if not exists appointments_user_idempotency_key_uidx
  on public.appointments (user_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists appointments_user_scheduled_at_idx
  on public.appointments (user_id, scheduled_at);

comment on column public.appointments.duration_minutes
  is 'Snapshot of appointment duration; independent from future service default changes.';
comment on column public.appointments.end_at
  is 'Database-maintained end instant derived from scheduled_at and duration_minutes.';
comment on column public.appointments.source
  is 'Agenda 2.0 origin: manual or return.';
