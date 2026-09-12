-- The attendance editor checks whether a procedure item already has a clinical return
-- linked before allowing the item to be removed. procedure_returns intentionally kept
-- write access backend-only, but SELECT had also been revoked, so the editor load failed
-- for every attendance as soon as it queried this table.
--
-- Restore read-only access for the authenticated owner while preserving backend-only
-- INSERT/UPDATE/DELETE behavior.

revoke select on table public.procedure_returns from anon;
grant select on table public.procedure_returns to authenticated;

drop policy if exists procedure_returns_select_own on public.procedure_returns;
create policy procedure_returns_select_own
  on public.procedure_returns
  for select
  to authenticated
  using (
    (select auth.uid()) is not null
    and user_id = (select auth.uid())
  );
