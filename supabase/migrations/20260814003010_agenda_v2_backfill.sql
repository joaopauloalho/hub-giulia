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
