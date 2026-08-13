-- procedure_returns keeps RLS enabled. Client access goes through these auth-scoped RPCs.

create or replace function public.list_procedure_returns_v2()
returns table (
  id uuid,
  patient_id uuid,
  patient_name text,
  patient_phone text,
  procedure_id uuid,
  procedure_item_id uuid,
  service_id uuid,
  service_name text,
  return_type text,
  procedure_date date,
  return_start_days integer,
  return_end_days integer,
  window_start date,
  window_end date,
  contacted_at timestamptz,
  contact_method text,
  appointment_id uuid,
  appointment_status text,
  appointment_scheduled_at timestamptz,
  completed_at timestamptz,
  completed_by_procedure_id uuid,
  dismissed_at timestamptz,
  dismissed_reason text,
  notes text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    pr.id,
    pr.patient_id,
    coalesce(p.name, pr.patient_name_snapshot),
    p.phone,
    pr.procedure_id,
    pr.procedure_item_id,
    pr.service_id,
    pr.service_name_snapshot,
    pr.return_type,
    pr.procedure_date,
    pr.return_start_days,
    pr.return_end_days,
    pr.window_start,
    pr.window_end,
    pr.contacted_at,
    pr.contact_method,
    pr.appointment_id,
    a.status,
    a.scheduled_at,
    pr.completed_at,
    pr.completed_by_procedure_id,
    pr.dismissed_at,
    pr.dismissed_reason,
    pr.notes,
    pr.created_at,
    pr.updated_at
  from public.procedure_returns pr
  left join public.patients p
    on p.id = pr.patient_id
   and p.user_id = auth.uid()
  left join public.appointments a
    on a.id = pr.appointment_id
   and a.user_id = auth.uid()
  where pr.user_id = auth.uid()
  order by
    case when pr.completed_at is null and pr.dismissed_at is null then 0 else 1 end,
    pr.window_end,
    pr.created_at;
$$;

create or replace function public.mark_procedure_return_contacted_v2(
  p_return_id uuid,
  p_method text default null
)
returns public.procedure_returns
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_return public.procedure_returns;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'RETURN_SESSION_REQUIRED';
  end if;
  if p_method is not null and p_method not in ('whatsapp', 'phone', 'other') then
    raise exception using errcode = '22023', message = 'RETURN_CONTACT_METHOD_INVALID';
  end if;

  update public.procedure_returns
  set contacted_at = now(), contact_method = p_method
  where id = p_return_id
    and user_id = v_user_id
    and completed_at is null
    and dismissed_at is null
  returning * into v_return;

  if not found then
    raise exception using errcode = 'P0001', message = 'RETURN_NOT_OPEN';
  end if;
  return v_return;
end;
$$;

create or replace function public.complete_procedure_return_v2(p_return_id uuid)
returns public.procedure_returns
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_return public.procedure_returns;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'RETURN_SESSION_REQUIRED';
  end if;

  update public.procedure_returns
  set completed_at = now()
  where id = p_return_id
    and user_id = v_user_id
    and completed_at is null
    and dismissed_at is null
  returning * into v_return;

  if not found then
    raise exception using errcode = 'P0001', message = 'RETURN_NOT_OPEN';
  end if;
  return v_return;
end;
$$;

create or replace function public.dismiss_procedure_return_v2(
  p_return_id uuid,
  p_reason text default null
)
returns public.procedure_returns
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_return public.procedure_returns;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'RETURN_SESSION_REQUIRED';
  end if;

  update public.procedure_returns
  set dismissed_at = now(), dismissed_reason = nullif(btrim(p_reason), '')
  where id = p_return_id
    and user_id = v_user_id
    and completed_at is null
    and dismissed_at is null
  returning * into v_return;

  if not found then
    raise exception using errcode = 'P0001', message = 'RETURN_NOT_OPEN';
  end if;
  return v_return;
end;
$$;

create or replace function public.link_procedure_return_appointment(
  p_return_id uuid,
  p_appointment_id uuid
)
returns public.procedure_returns
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

revoke all on function public.list_procedure_returns_v2() from public;
revoke all on function public.mark_procedure_return_contacted_v2(uuid, text) from public;
revoke all on function public.complete_procedure_return_v2(uuid) from public;
revoke all on function public.dismiss_procedure_return_v2(uuid, text) from public;
revoke all on function public.link_procedure_return_appointment(uuid, uuid) from public;

grant execute on function public.list_procedure_returns_v2() to authenticated;
grant execute on function public.mark_procedure_return_contacted_v2(uuid, text) to authenticated;
grant execute on function public.complete_procedure_return_v2(uuid) to authenticated;
grant execute on function public.dismiss_procedure_return_v2(uuid, text) to authenticated;
grant execute on function public.link_procedure_return_appointment(uuid, uuid) to authenticated;
