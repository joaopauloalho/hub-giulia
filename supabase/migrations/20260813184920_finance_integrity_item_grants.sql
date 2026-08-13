revoke all privileges on table public.procedure_items from anon;
revoke all privileges on table public.procedure_items from authenticated;
grant select, insert on table public.procedure_items to authenticated;
