-- Rebuild bridge for the production schema/trigger semantics recorded under
-- 20260813185424_finance_integrity_ledger_rollup.
--
-- The repository's applied migration is intentionally preserved as a history
-- marker. Production already has this schema/function/trigger. This bridge
-- restores those semantics for clean reconstruction from Git.
--
-- Deliberately NO historical data backfill is repeated here. A clean rebuild
-- has no production rows to backfill, and if this bridge is ever encountered by
-- a linked production migration workflow it must not rewrite financial history.

alter table public.procedures
  add column if not exists paid_amount numeric not null default 0,
  add column if not exists paid_fee_value numeric not null default 0,
  add column if not exists paid_net_value numeric not null default 0,
  add column if not exists pending_amount numeric not null default 0;

create or replace function public.sync_procedure_ledger_rollup()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_procedure_id uuid;
begin
  v_procedure_id := coalesce(new.procedure_id, old.procedure_id);

  update public.procedures p
  set
    paid_amount = coalesce((
      select sum(pp.amount) from public.procedure_payments pp
      where pp.procedure_id = v_procedure_id and pp.paid_at is not null
    ), 0),
    paid_fee_value = coalesce((
      select sum(coalesce(pp.fee_value, 0)) from public.procedure_payments pp
      where pp.procedure_id = v_procedure_id and pp.paid_at is not null
    ), 0),
    paid_net_value = coalesce((
      select sum(pp.net_amount) from public.procedure_payments pp
      where pp.procedure_id = v_procedure_id and pp.paid_at is not null
    ), 0),
    pending_amount = coalesce((
      select sum(pp.amount) from public.procedure_payments pp
      where pp.procedure_id = v_procedure_id and pp.paid_at is null
    ), 0)
  where p.id = v_procedure_id;

  if tg_op = 'UPDATE' and old.procedure_id is distinct from new.procedure_id then
    update public.procedures p
    set
      paid_amount = coalesce((select sum(pp.amount) from public.procedure_payments pp where pp.procedure_id = old.procedure_id and pp.paid_at is not null), 0),
      paid_fee_value = coalesce((select sum(coalesce(pp.fee_value, 0)) from public.procedure_payments pp where pp.procedure_id = old.procedure_id and pp.paid_at is not null), 0),
      paid_net_value = coalesce((select sum(pp.net_amount) from public.procedure_payments pp where pp.procedure_id = old.procedure_id and pp.paid_at is not null), 0),
      pending_amount = coalesce((select sum(pp.amount) from public.procedure_payments pp where pp.procedure_id = old.procedure_id and pp.paid_at is null), 0)
    where p.id = old.procedure_id;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_sync_procedure_ledger_rollup on public.procedure_payments;
create trigger trg_sync_procedure_ledger_rollup
after insert or update or delete on public.procedure_payments
for each row execute function public.sync_procedure_ledger_rollup();
