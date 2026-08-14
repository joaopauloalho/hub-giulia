-- Hub Giulia 1.9 — Agenda 2.0: race-safe overlap protection.
-- Serialize active scheduling writes per user. This protects concurrent devices and
-- remains correct while legacy rows are being backfilled because their duration is
-- resolved from the linked service (or the explicit 60-minute fallback).

create or replace function public.enforce_appointment_no_overlap_v2()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_conflict_id uuid;
begin
  if new.status not in ('pendente', 'confirmado') then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 1979));

  select a.id into v_conflict_id
  from public.appointments a
  left join public.services s
    on s.id = a.service_id
   and s.user_id = a.user_id
  where a.user_id = new.user_id
    and a.id <> new.id
    and a.status in ('pendente', 'confirmado')
    and tstzrange(
      a.scheduled_at,
      a.scheduled_at + make_interval(mins => coalesce(nullif(a.duration_minutes, 0), nullif(s.duration_minutes, 0), 60)),
      '[)'
    ) && tstzrange(new.scheduled_at, new.end_at, '[)')
  limit 1;

  if v_conflict_id is not null then
    raise exception using
      errcode = '23P01',
      message = 'APPOINTMENT_TIME_CONFLICT',
      constraint = 'appointments_no_active_overlap';
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_appointment_no_overlap_v2() from public;
revoke all on function public.enforce_appointment_no_overlap_v2() from anon;

drop trigger if exists trg_enforce_appointment_no_overlap_v2 on public.appointments;
create trigger trg_enforce_appointment_no_overlap_v2
before insert or update of scheduled_at, duration_minutes, status, user_id on public.appointments
for each row execute function public.enforce_appointment_no_overlap_v2();

create index if not exists appointments_user_status_scheduled_at_idx
  on public.appointments (user_id, status, scheduled_at);
