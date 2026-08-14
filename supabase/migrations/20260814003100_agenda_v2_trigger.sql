-- Hub Giulia 1.9 — Agenda 2.0: database-owned end time, metadata and transitions.

create or replace function public.prepare_appointment_v2()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_service_duration integer;
  v_sync_relevant_change boolean := false;
begin
  if new.scheduled_at is null then
    raise exception using errcode = '22023', message = 'APPOINTMENT_SCHEDULE_REQUIRED';
  end if;

  if tg_op = 'UPDATE' then
    v_sync_relevant_change := row(new.patient_id, new.service_id, new.scheduled_at, new.duration_minutes, new.status, new.notes)
      is distinct from row(old.patient_id, old.service_id, old.scheduled_at, old.duration_minutes, old.status, old.notes);
  end if;

  if new.duration_minutes is null or new.duration_minutes <= 0 then
    if new.service_id is not null then
      select s.duration_minutes into v_service_duration
      from public.services s
      where s.id = new.service_id and s.user_id = new.user_id;
    end if;
    new.duration_minutes := coalesce(nullif(v_service_duration, 0), 60);
  end if;

  if new.duration_minutes <= 0 or new.duration_minutes > 1440 then
    raise exception using errcode = '22023', message = 'APPOINTMENT_DURATION_INVALID';
  end if;

  if tg_op = 'UPDATE'
     and (new.scheduled_at is distinct from old.scheduled_at
       or new.duration_minutes is distinct from old.duration_minutes) then
    new.previous_scheduled_at := old.scheduled_at;
    new.previous_duration_minutes := old.duration_minutes;
    new.last_rescheduled_at := now();
  end if;

  new.end_at := new.scheduled_at + make_interval(mins => new.duration_minutes);
  new.updated_at := now();
  new.cancellation_reason := nullif(btrim(new.cancellation_reason), '');

  if tg_op = 'INSERT' then
    if new.status = 'confirmado' then
      new.confirmed_at := coalesce(new.confirmed_at, now());
    elsif new.status = 'cancelado' then
      new.canceled_at := coalesce(new.canceled_at, now());
    elsif new.status = 'nao_compareceu' then
      new.no_show_at := coalesce(new.no_show_at, now());
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if old.status = 'pendente' and new.status not in ('confirmado', 'realizado', 'cancelado', 'nao_compareceu') then
      raise exception using errcode = 'P0001', message = 'APPOINTMENT_STATUS_TRANSITION_INVALID';
    elsif old.status = 'confirmado' and new.status not in ('pendente', 'realizado', 'cancelado', 'nao_compareceu') then
      raise exception using errcode = 'P0001', message = 'APPOINTMENT_STATUS_TRANSITION_INVALID';
    elsif old.status = 'realizado' and new.status <> 'confirmado' then
      raise exception using errcode = 'P0001', message = 'APPOINTMENT_STATUS_TRANSITION_INVALID';
    elsif old.status in ('cancelado', 'nao_compareceu') and new.status not in ('pendente', 'confirmado') then
      raise exception using errcode = 'P0001', message = 'APPOINTMENT_STATUS_TRANSITION_INVALID';
    end if;

    if new.status = 'confirmado' then
      new.confirmed_at := coalesce(new.confirmed_at, now());
    elsif new.status = 'cancelado' then
      new.canceled_at := coalesce(new.canceled_at, now());
    elsif new.status = 'nao_compareceu' then
      new.no_show_at := coalesce(new.no_show_at, now());
    end if;
  end if;

  if v_sync_relevant_change then
    new.google_sync_status := 'pending';
    new.google_sync_error_code := null;
  end if;

  return new;
end;
$function$;

revoke all on function public.prepare_appointment_v2() from public;
revoke all on function public.prepare_appointment_v2() from anon;

drop trigger if exists trg_prepare_appointment_v2 on public.appointments;
create trigger trg_prepare_appointment_v2
before insert or update on public.appointments
for each row execute function public.prepare_appointment_v2();
