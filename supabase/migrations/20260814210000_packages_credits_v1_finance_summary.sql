-- Hub Giulia 3.2 — consolidated finance summary without double-counting package consumption.
create or replace function public.get_finance_summary_v2(
  p_start timestamptz,
  p_end timestamptz
)
returns table(
  procedure_sales numeric,
  procedure_received numeric,
  procedure_fees numeric,
  procedure_net numeric,
  procedure_pending numeric,
  procedure_costs numeric,
  package_sales numeric,
  package_received numeric,
  package_fees numeric,
  package_net numeric,
  package_pending numeric,
  package_consumed_value numeric,
  total_sales numeric,
  total_received numeric,
  total_fees numeric,
  total_net numeric,
  total_pending numeric,
  total_costs numeric,
  cash_result numeric
)
language sql
stable
security invoker
set search_path=public,pg_temp
as $$
with proc_scope as (
  select p.id,p.total_value,p.total_cost,p.covered_value
  from public.procedures p
  where p.user_id=auth.uid()
    and p.performed_at>=p_start
    and p.performed_at<p_end
),
proc_totals as (
  select
    coalesce(sum(total_value),0)::numeric as sales,
    coalesce(sum(total_cost),0)::numeric as costs,
    coalesce(sum(covered_value),0)::numeric as covered
  from proc_scope
),
proc_pay as (
  select
    coalesce(sum(case when pp.paid_at is not null then pp.amount else 0 end),0)::numeric as received,
    coalesce(sum(case when pp.paid_at is not null then coalesce(pp.fee_value,0) else 0 end),0)::numeric as fees,
    coalesce(sum(case when pp.paid_at is not null then pp.net_amount else 0 end),0)::numeric as net,
    coalesce(sum(case when pp.paid_at is null then pp.amount else 0 end),0)::numeric as pending
  from public.procedure_payments pp
  join proc_scope ps on ps.id=pp.procedure_id
  where pp.user_id=auth.uid()
),
package_scope as (
  select p.id,p.commercial_total_snapshot
  from public.patient_packages p
  where p.user_id=auth.uid()
    and p.sale_recorded_at is not null
    and p.sale_recorded_at>=p_start
    and p.sale_recorded_at<p_end
    and p.source_type not in ('voucher','complimentary')
),
package_totals as (
  select coalesce(sum(commercial_total_snapshot),0)::numeric as sales from package_scope
),
package_pay as (
  select
    coalesce(sum(case when pp.paid_at is not null then pp.amount else 0 end),0)::numeric as received,
    coalesce(sum(case when pp.paid_at is not null then coalesce(pp.fee_value,0) else 0 end),0)::numeric as fees,
    coalesce(sum(case when pp.paid_at is not null then pp.net_amount else 0 end),0)::numeric as net,
    coalesce(sum(case when pp.paid_at is null then pp.base_amount else 0 end),0)::numeric as pending
  from public.package_payments pp
  join package_scope ps on ps.id=pp.package_id
  where pp.user_id=auth.uid()
)
select
  round(pt.sales,2),
  round(pp.received,2),
  round(pp.fees,2),
  round(pp.net,2),
  round(pp.pending,2),
  round(pt.costs,2),
  round(pkt.sales,2),
  round(pkp.received,2),
  round(pkp.fees,2),
  round(pkp.net,2),
  round(pkp.pending,2),
  round(pt.covered,2),
  round(pt.sales+pkt.sales,2),
  round(pp.received+pkp.received,2),
  round(pp.fees+pkp.fees,2),
  round(pp.net+pkp.net,2),
  round(pp.pending+pkp.pending,2),
  round(pt.costs,2),
  round(pp.net+pkp.net-pt.costs,2)
from proc_totals pt cross join proc_pay pp cross join package_totals pkt cross join package_pay pkp;
$$;

revoke all on function public.get_finance_summary_v2(timestamptz,timestamptz) from public,anon;
grant execute on function public.get_finance_summary_v2(timestamptz,timestamptz) to authenticated;
