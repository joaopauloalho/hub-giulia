-- Traceability v1 — execute v5 attendance wrappers in a controlled definer context.
-- Internal traceability helpers stay non-executable by authenticated clients.

alter function public.create_procedure_v5(
  uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb,text
) security definer;

alter function public.create_procedure_with_injectable_draft_v5(
  uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,text,uuid,bigint
) security definer;

revoke all on function public.create_procedure_v5(
  uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb,text
) from public, anon;
grant execute on function public.create_procedure_v5(
  uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb,text
) to authenticated;

revoke all on function public.create_procedure_with_injectable_draft_v5(
  uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,text,uuid,bigint
) from public, anon;
grant execute on function public.create_procedure_with_injectable_draft_v5(
  uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,text,uuid,bigint
) to authenticated;
