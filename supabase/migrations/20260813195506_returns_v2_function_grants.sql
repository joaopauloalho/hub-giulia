-- Hub Giulia 1.7 — Retornos 2.0
-- Harden SECURITY DEFINER execute grants.

revoke execute on function public.list_procedure_returns_v2() from anon;
revoke execute on function public.mark_procedure_return_contacted_v2(uuid, text) from anon;
revoke execute on function public.complete_procedure_return_v2(uuid) from anon;
revoke execute on function public.dismiss_procedure_return_v2(uuid, text) from anon;
revoke execute on function public.link_procedure_return_appointment(uuid, uuid) from anon;
revoke execute on function public.schedule_procedure_return_v2(uuid, timestamptz, text) from anon;

revoke execute on function public.generate_return_from_procedure_item() from public, anon, authenticated;
revoke execute on function public.complete_return_from_attendance_appointment() from public, anon, authenticated;

grant execute on function public.list_procedure_returns_v2() to authenticated;
grant execute on function public.mark_procedure_return_contacted_v2(uuid, text) to authenticated;
grant execute on function public.complete_procedure_return_v2(uuid) to authenticated;
grant execute on function public.dismiss_procedure_return_v2(uuid, text) to authenticated;
grant execute on function public.link_procedure_return_appointment(uuid, uuid) to authenticated;
grant execute on function public.schedule_procedure_return_v2(uuid, timestamptz, text) to authenticated;
