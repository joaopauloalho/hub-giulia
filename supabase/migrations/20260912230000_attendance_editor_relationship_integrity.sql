-- Keep the repository schema aligned with the owner-scoped relationships that
-- already exist in production. EditAttendancePage uses these named foreign-key
-- relationships in PostgREST embeds; without them a clean migration rebuild
-- cannot load an existing attendance even though production can.

create unique index if not exists procedures_id_user_id_uidx
  on public.procedures (id, user_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.procedure_items'::regclass
      and conname = 'procedure_items_procedure_owner_fkey'
  ) then
    alter table public.procedure_items
      add constraint procedure_items_procedure_owner_fkey
      foreign key (procedure_id, user_id)
      references public.procedures (id, user_id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.procedure_payments'::regclass
      and conname = 'procedure_payments_procedure_owner_fkey'
  ) then
    alter table public.procedure_payments
      add constraint procedure_payments_procedure_owner_fkey
      foreign key (procedure_id, user_id)
      references public.procedures (id, user_id)
      on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.procedure_materials'::regclass
      and conname = 'procedure_materials_procedure_owner_fkey'
  ) then
    alter table public.procedure_materials
      add constraint procedure_materials_procedure_owner_fkey
      foreign key (procedure_id, user_id)
      references public.procedures (id, user_id)
      on delete cascade;
  end if;
end
$$;
