-- Hub Giulia 1.7 — Retornos 2.0
-- Creates the appointment and links it to the return in one transaction.

create or replace function public.schedule_procedure_return_v2(
  p_return_id uuid,
  p_scheduled_at timestamptz,
  p_notes text default null
)
returns public.appointments
language plpgsql
security definer
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
  if p_scheduled_at is null then
    raise exception using errcode = '22023', message = 'RETURN_APPOINTMENT_DATE_REQUIRED';
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
  if v_return.patient_id is null then
    raise exception using errcode = 'P0001', message = 'RETURN_PATIENT_UNAVAILABLE';
  end if;
  if v_return.appointment_id is not null and exists (
    select 1 from public.appointments a
    where a.id = v_return.appointment_id
      and a.user_id = v_user_id
      and a.status <> 'cancelado'
  ) then
    raise exception using errcode = 'P0001', message = 'RETURN_ALREADY_SCHEDULED';
  end if;

  insert into public.appointments (
    user_id,
    patient_id,
    service_id,
    scheduled_at,
    status,
    notes
  ) values (
    v_user_id,
    v_return.patient_id,
    v_return.service_id,
    p_scheduled_at,
    'pendente',
    coalesce(nullif(btrim(p_notes), ''), 'Retorno: ' || v_return.service_name_snapshot)
  )
  returning * into v_appointment;

  update public.procedure_returns
  set appointment_id = v_appointment.id
  where id = v_return.id
    and user_id = v_user_id;

  return v_appointment;
end;
$$;

revoke all on function public.schedule_procedure_return_v2(uuid, timestamptz, text) from public;
grant execute on function public.schedule_procedure_return_v2(uuid, timestamptz, text) to authenticated;
