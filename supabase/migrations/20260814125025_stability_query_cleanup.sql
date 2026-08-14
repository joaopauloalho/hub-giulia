-- Hub Giulia 2.1.1 — Stability & Query Cleanup
-- Keep ownership FKs intact; improve FK coverage and least-privilege function exposure.

create index if not exists patient_notes_patient_user_idx
  on public.patient_notes (patient_id, user_id);

create index if not exists services_user_id_idx
  on public.services (user_id);

create index if not exists contract_templates_user_id_idx
  on public.contract_templates (user_id);

-- Internal trigger helper: triggers do not require API roles to EXECUTE the function directly.
revoke execute on function public.anamnesis_guard_direct_write_v2()
  from public, anon, authenticated;

-- SECURITY DEFINER RPCs remain intentionally callable by authenticated users,
-- but keep an explicit safe search_path including pg_temp.
alter function public.complete_procedure_return_v2(uuid)
  set search_path = public, pg_temp;
alter function public.dismiss_procedure_return_v2(uuid, text)
  set search_path = public, pg_temp;
alter function public.list_procedure_returns_v2()
  set search_path = public, pg_temp;
alter function public.mark_procedure_return_contacted_v2(uuid, text)
  set search_path = public, pg_temp;
alter function public.schedule_procedure_return_v2(uuid, timestamptz, text)
  set search_path = public, pg_temp;
alter function public.link_procedure_return_appointment(uuid, uuid)
  set search_path = public, pg_temp;
