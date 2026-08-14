drop policy if exists procedure_payments_update_own on public.procedure_payments;
create policy procedure_payments_update_own on public.procedure_payments
for update to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.procedures p
    where p.id = procedure_payments.procedure_id
      and p.user_id = (select auth.uid())
  )
);
