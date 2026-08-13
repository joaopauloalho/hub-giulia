-- Hub Giulia 1.7 — Retornos 2.0
-- RLS policies. procedure_returns already has RLS enabled by the schema migration.

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
