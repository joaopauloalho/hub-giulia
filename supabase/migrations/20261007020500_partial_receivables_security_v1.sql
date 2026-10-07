-- Hub Giulia — partial receivables security v1
-- Keep the read model under caller RLS and make the receipt mutation authenticated-only.

alter function public.list_open_receivables_v1(uuid) security invoker;

revoke execute on function public.list_open_receivables_v1(uuid) from public;
revoke execute on function public.list_open_receivables_v1(uuid) from anon;
grant execute on function public.list_open_receivables_v1(uuid) to authenticated;

revoke execute on function public.register_procedure_receipt_v1(uuid,numeric,text,date,text,integer,boolean,numeric) from public;
revoke execute on function public.register_procedure_receipt_v1(uuid,numeric,text,date,text,integer,boolean,numeric) from anon;
grant execute on function public.register_procedure_receipt_v1(uuid,numeric,text,date,text,integer,boolean,numeric) to authenticated;
