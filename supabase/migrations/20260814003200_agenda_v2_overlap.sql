-- Hub Giulia 1.9 — Agenda 2.0: race-safe overlap protection.
-- Backfill and NOT NULL migrations run first, so end_at is authoritative here.
-- [start, end) permits 14:00-15:00 followed by 15:00-16:00.

create extension if not exists btree_gist with schema extensions;

alter table public.appointments
  add constraint appointments_no_active_overlap
  exclude using gist (
    user_id with =,
    tstzrange(scheduled_at, end_at, '[)') with &&
  )
  where (status in ('pendente', 'confirmado'));

create index if not exists appointments_user_status_scheduled_at_idx
  on public.appointments (user_id, status, scheduled_at);
