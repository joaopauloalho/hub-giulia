-- Keep package history immutable across procedure deletion: validate live refs on insert,
-- preserve UUID snapshots afterwards instead of mutating ledger/redemption rows.
alter table public.patient_credit_ledger drop constraint patient_credit_ledger_procedure_owner_fkey;
alter table public.patient_credit_ledger drop constraint patient_credit_ledger_procedure_item_owner_fkey;
alter table public.package_redemptions drop constraint package_redemptions_procedure_owner_fkey;
alter table public.package_redemptions drop constraint package_redemptions_procedure_item_owner_fkey;

create or replace function public.validate_package_history_procedure_refs_v1()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.procedure_id is not null and not exists(select 1 from public.procedures p where p.id=new.procedure_id and p.user_id=new.user_id) then
    raise exception using errcode='P0001',message='PACKAGE_HISTORY_PROCEDURE_FORBIDDEN';
  end if;
  if new.procedure_item_id is not null and not exists(select 1 from public.procedure_items i where i.id=new.procedure_item_id and i.user_id=new.user_id) then
    raise exception using errcode='P0001',message='PACKAGE_HISTORY_PROCEDURE_ITEM_FORBIDDEN';
  end if;
  return new;
end; $$;
create trigger patient_credit_ledger_validate_procedure_refs_bi before insert on public.patient_credit_ledger for each row execute function public.validate_package_history_procedure_refs_v1();
create trigger package_redemptions_validate_procedure_refs_bi before insert on public.package_redemptions for each row execute function public.validate_package_history_procedure_refs_v1();
revoke all on function public.validate_package_history_procedure_refs_v1() from public,anon,authenticated;
