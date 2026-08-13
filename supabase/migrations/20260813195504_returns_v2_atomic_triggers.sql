-- Hub Giulia 1.7 — Retornos 2.0
-- These triggers run inside the same transaction as Atomic Attendance v2.

create or replace function public.generate_return_from_procedure_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_procedure public.procedures;
  v_service public.services;
  v_patient_name text;
  v_procedure_date date;
begin
  select * into v_procedure
  from public.procedures p
  where p.id = new.procedure_id
    and p.user_id = new.user_id;

  if not found then
    return new;
  end if;

  select * into v_service
  from public.services s
  where s.id = new.service_id
    and s.user_id = new.user_id
    and s.return_enabled = true;

  if not found then
    return new;
  end if;

  select p.name into v_patient_name
  from public.patients p
  where p.id = v_procedure.patient_id
    and p.user_id = new.user_id;

  if v_patient_name is null then
    return new;
  end if;

  v_procedure_date := (v_procedure.performed_at at time zone 'America/Sao_Paulo')::date;

  insert into public.procedure_returns (
    user_id,
    patient_id,
    patient_name_snapshot,
    procedure_id,
    procedure_item_id,
    service_id,
    service_name_snapshot,
    return_type,
    procedure_date,
    return_start_days,
    return_end_days,
    window_start,
    window_end
  ) values (
    new.user_id,
    v_procedure.patient_id,
    v_patient_name,
    v_procedure.id,
    new.id,
    new.service_id,
    new.name,
    v_service.return_type,
    v_procedure_date,
    v_service.return_min_days,
    v_service.return_max_days,
    v_procedure_date + v_service.return_min_days,
    v_procedure_date + v_service.return_max_days
  )
  on conflict (user_id, procedure_item_id, return_type)
    where procedure_item_id is not null
  do nothing;

  return new;
end;
$$;

drop trigger if exists trg_generate_return_from_procedure_item on public.procedure_items;
create trigger trg_generate_return_from_procedure_item
after insert on public.procedure_items
for each row execute function public.generate_return_from_procedure_item();

create or replace function public.complete_return_from_attendance_appointment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_completed_by_procedure_id uuid;
begin
  if new.status <> 'realizado' or old.status = 'realizado' then
    return new;
  end if;

  select p.id into v_completed_by_procedure_id
  from public.procedures p
  where p.appointment_id = new.id
    and p.user_id = new.user_id
    and p.patient_id = new.patient_id
  order by p.created_at desc
  limit 1;

  if v_completed_by_procedure_id is null then
    return new;
  end if;

  update public.procedure_returns pr
  set
    completed_at = coalesce(pr.completed_at, now()),
    completed_by_procedure_id = coalesce(pr.completed_by_procedure_id, v_completed_by_procedure_id)
  where pr.user_id = new.user_id
    and pr.patient_id = new.patient_id
    and pr.appointment_id = new.id
    and pr.completed_at is null
    and pr.dismissed_at is null;

  return new;
end;
$$;

drop trigger if exists trg_complete_return_from_attendance_appointment on public.appointments;
create trigger trg_complete_return_from_attendance_appointment
after update of status on public.appointments
for each row execute function public.complete_return_from_attendance_appointment();
