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
  add column if not exists idempotency_key uuid,
  add column if not exists previous_scheduled_at timestamptz,
  add column if not exists previous_duration_minutes integer,
  add column if not exists last_rescheduled_at timestamptz;

-- Compatibility guard installed in the same migration as the columns. The old
-- frontend may continue creating appointments while the remaining migrations run.
create or replace function public.prepare_appointment_v2()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_service_duration integer;
begin
  if new.duration_minutes is null or new.duration_minutes <= 0 then
    if new.service_id is not null then
      select s.duration_minutes into v_service_duration
      from public.services s
      where s.id = new.service_id and s.user_id = new.user_id;
    end if;
    new.duration_minutes := coalesce(nullif(v_service_duration, 0), 60);
  end if;
  new.end_at := new.scheduled_at + make_interval(mins => new.duration_minutes);
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists trg_prepare_appointment_v2 on public.appointments;
create trigger trg_prepare_appointment_v2
before insert or update on public.appointments
for each row execute function public.prepare_appointment_v2();
