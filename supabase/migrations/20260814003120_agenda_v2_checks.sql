alter table public.appointments
  drop constraint if exists appointments_duration_minutes_check,
  drop constraint if exists appointments_end_after_start_check,
  drop constraint if exists appointments_source_check,
  drop constraint if exists appointments_google_sync_status_check;

alter table public.appointments
  add constraint appointments_duration_minutes_check
    check (duration_minutes is null or (duration_minutes > 0 and duration_minutes <= 1440)),
  add constraint appointments_end_after_start_check
    check (end_at is null or end_at > scheduled_at),
  add constraint appointments_source_check
    check (source = any (array['manual'::text, 'return'::text])),
  add constraint appointments_google_sync_status_check
    check (google_sync_status = any (array['synced'::text, 'pending'::text, 'error'::text, 'disconnected'::text]));

create unique index if not exists appointments_user_idempotency_key_uidx
  on public.appointments (user_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists appointments_user_scheduled_at_idx
  on public.appointments (user_id, scheduled_at);
