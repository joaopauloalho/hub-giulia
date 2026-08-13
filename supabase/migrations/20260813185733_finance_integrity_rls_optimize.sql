drop policy if exists "procedure_items_select_own" on public.procedure_items;
create policy "procedure_items_select_own"
on public.procedure_items for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "procedure_items_insert_own" on public.procedure_items;
create policy "procedure_items_insert_own"
on public.procedure_items for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.procedures p
    where p.id = procedure_items.procedure_id
      and p.user_id = (select auth.uid())
  )
);
