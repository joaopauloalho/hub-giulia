-- Hub Giulia 1.7 — Retornos 2.0
-- RLS, immutable history guards and explicit grants.

create or replace function public.touch_procedure_return_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.guard_procedure_return_history()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.user_id is distinct from old.user_id
     or new.patient_name_snapshot is distinct from old.patient_name_snapshot
     or new.service_name_snapshot is distinct from old.service_name_snapshot
     or new.return_type is distinct from old.return_type
     or new.procedure_date is distinct from old.procedure_date
     or new.return_start_days is distinct from old.return_start_days
     or new.return_end_days is distinct from old.return_end_days
     or new.window_start is distinct from old.window_start
     or new.window_end is distinct from old.window_end then
    raise exception using errcode = 'P0001', message = 'RETURN_HISTORY_IMMUTABLE';
  end if;

  -- Historical references may be nulled by ON DELETE SET NULL, but never reassigned.
  if new.patient_id is distinct from old.patient_id and new.patient_id is not null then
    raise exception using errcode = 'P0001', message = 'RETURN_PATIENT_IMMUTABLE';
  end if;
  if new.procedure_id is distinct from old.procedure_id and new.procedure_id is not null then
    raise exception using errcode = 'P0001', message = 'RETURN_PROCEDURE_IMMUTABLE';
  end if;
  if new.procedure_item_id is distinct from old.procedure_item_id and new.procedure_item_id is not null then
    raise exception using errcode = 'P0001', message = 'RETURN_PROCEDURE_ITEM_IMMUTABLE';
  end if;
  if new.service_id is distinct from old.service_id and new.service_id is not null then
    raise exception using errcode = 'P0001', message = 'RETURN_SERVICE_IMMUTABLE';
  end if;

  return new;
end;
$$;

create trigger trg_procedure_returns_guard_history
before update on public.procedure_returns
for each row execute function public.guard_procedure_return_history();

create trigger trg_procedure_returns_touch_updated_at
before update on public.procedure_returns
for each row execute function public.touch_procedure_return_updated_at();

create policy procedure_returns_select_own
on public.procedure_returns
for select
to authenticated
using (user_id = (select auth.uid()));

create policy procedure_returns_insert_own
on public.procedure_returns
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and patient_id is not null
  and procedure_id is not null
  and procedure_item_id is not null
  and exists (
    select 1 from public.patients p
    where p.id = procedure_returns.patient_id
      and p.user_id = (select auth.uid())
  )
  and exists (
    select 1 from public.procedures p
    where p.id = procedure_returns.procedure_id
      and p.patient_id = procedure_returns.patient_id
      and p.user_id = (select auth.uid())
  )
  and exists (
    select 1 from public.procedure_items pi
    where pi.id = procedure_returns.procedure_item_id
      and pi.procedure_id = procedure_returns.procedure_id
      and pi.user_id = (select auth.uid())
  )
  and (
    service_id is null
    or exists (
      select 1 from public.services s
      where s.id = procedure_returns.service_id
        and s.user_id = (select auth.uid())
    )
  )
  and appointment_id is null
  and completed_by_procedure_id is null
);

create policy procedure_returns_update_own
on public.procedure_returns
for update
to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and (
    patient_id is null
    or exists (
      select 1 from public.patients p
      where p.id = procedure_returns.patient_id
        and p.user_id = (select auth.uid())
    )
  )
  and (
    procedure_id is null
    or exists (
      select 1 from public.procedures p
      where p.id = procedure_returns.procedure_id
        and p.user_id = (select auth.uid())
    )
  )
  and (
    procedure_item_id is null
    or exists (
      select 1 from public.procedure_items pi
      where pi.id = procedure_returns.procedure_item_id
        and pi.user_id = (select auth.uid())
    )
  )
  and (
    service_id is null
    or exists (
      select 1 from public.services s
      where s.id = procedure_returns.service_id
        and s.user_id = (select auth.uid())
    )
  )
  and (
    appointment_id is null
    or exists (
      select 1 from public.appointments a
      where a.id = procedure_returns.appointment_id
        and a.user_id = (select auth.uid())
        and (procedure_returns.patient_id is null or a.patient_id = procedure_returns.patient_id)
    )
  )
  and (
    completed_by_procedure_id is null
    or exists (
      select 1 from public.procedures p
      where p.id = procedure_returns.completed_by_procedure_id
        and p.user_id = (select auth.uid())
    )
  )
);

revoke all on table public.procedure_returns from anon;
revoke delete on table public.procedure_returns from authenticated;
grant select, insert, update on table public.procedure_returns to authenticated;
