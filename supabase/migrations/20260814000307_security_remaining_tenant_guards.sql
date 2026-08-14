alter table public.pix_installments drop constraint if exists pix_installments_procedure_owner_fkey;
alter table public.pix_installments add constraint pix_installments_procedure_owner_fkey
  foreign key (procedure_id, user_id) references public.procedures(id, user_id) not valid;
alter table public.pix_installments validate constraint pix_installments_procedure_owner_fkey;

alter table public.procedure_items drop constraint if exists procedure_items_procedure_owner_fkey;
alter table public.procedure_items add constraint procedure_items_procedure_owner_fkey
  foreign key (procedure_id, user_id) references public.procedures(id, user_id) not valid;
alter table public.procedure_items validate constraint procedure_items_procedure_owner_fkey;

alter table public.procedure_items drop constraint if exists procedure_items_service_owner_fkey;
alter table public.procedure_items add constraint procedure_items_service_owner_fkey
  foreign key (service_id, user_id) references public.services(id, user_id) not valid;
alter table public.procedure_items validate constraint procedure_items_service_owner_fkey;

create index if not exists pix_installments_user_procedure_idx on public.pix_installments(user_id, procedure_id);
create index if not exists procedure_items_user_procedure_idx on public.procedure_items(user_id, procedure_id);
create index if not exists procedure_items_user_service_idx on public.procedure_items(user_id, service_id);

drop policy if exists "users see own pix_installments" on public.pix_installments;
drop policy if exists pix_installments_own on public.pix_installments;
create policy pix_installments_own on public.pix_installments
for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));
