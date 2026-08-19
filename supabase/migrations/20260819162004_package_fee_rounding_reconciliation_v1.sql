-- Hub Giulia 4.4 — deterministic package-sale fee rounding.
-- Package fees are amortized by canonical commercial value. The cumulative-cent
-- method makes each redemption equal the delta between rounded cumulative shares,
-- so a fully consumed package reconciles exactly to the recorded package fee.

create or replace view public.service_financial_item_facts_v1
with (security_invoker=true)
as
with procedure_payment_fees as (
  select
    pp.user_id,
    pp.procedure_id,
    round(sum(case
      when pp.fee_value is not null then pp.fee_value
      when abs(pp.amount-pp.net_amount)<=0.02 then 0
      else 0
    end),2)::numeric(14,2) as procedure_fee_total,
    bool_and(pp.fee_value is not null or abs(pp.amount-pp.net_amount)<=0.02) as procedure_fee_source_known
  from public.procedure_payments pp
  group by pp.user_id,pp.procedure_id
),
item_direct as (
  select
    pi.*,
    p.patient_id,
    p.performed_at,
    greatest(coalesce(pi.amount_due_snapshot,0),0)::numeric(14,2) as direct_due,
    coalesce(pf.procedure_fee_total,0)::numeric(14,2) as procedure_fee_total,
    coalesce(pf.procedure_fee_source_known,true) as procedure_fee_source_known,
    sum(greatest(coalesce(pi.amount_due_snapshot,0),0)) over(partition by pi.user_id,pi.procedure_id)::numeric(14,2) as procedure_direct_due_total
  from public.procedure_items pi
  join public.procedures p
    on p.id=pi.procedure_id and p.user_id=pi.user_id
  left join procedure_payment_fees pf
    on pf.procedure_id=pi.procedure_id and pf.user_id=pi.user_id
),
direct_fee_raw as (
  select
    d.*,
    round(d.procedure_fee_total*100)::bigint as fee_cents,
    case
      when d.procedure_direct_due_total>0
      then (round(d.procedure_fee_total*100)::numeric*d.direct_due/d.procedure_direct_due_total)
      else 0::numeric
    end as raw_fee_cents
  from item_direct d
),
direct_fee_floor as (
  select
    r.*,
    floor(r.raw_fee_cents)::bigint as base_fee_cents,
    (r.raw_fee_cents-floor(r.raw_fee_cents)) as fee_fraction
  from direct_fee_raw r
),
direct_fee_ranked as (
  select
    f.*,
    sum(f.base_fee_cents) over(partition by f.user_id,f.procedure_id)::bigint as base_fee_cents_total,
    row_number() over(
      partition by f.user_id,f.procedure_id
      order by f.fee_fraction desc,f.id
    ) as residual_rank
  from direct_fee_floor f
),
direct_fee_allocated as (
  select
    f.*,
    case
      when not f.procedure_fee_source_known then false
      when f.procedure_direct_due_total=0 and f.procedure_fee_total<>0 then false
      else true
    end as direct_fee_known,
    case
      when not f.procedure_fee_source_known then null::numeric
      when f.procedure_direct_due_total=0 and f.procedure_fee_total<>0 then null::numeric
      else (
        f.base_fee_cents
        + case when f.residual_rank <= greatest(f.fee_cents-f.base_fee_cents_total,0) then 1 else 0 end
      )::numeric/100
    end::numeric(14,2) as direct_fee_allocated
  from direct_fee_ranked f
),
package_payment_fees as (
  select
    pay.user_id,
    pay.package_id,
    round(sum(case
      when pay.fee_value is not null then pay.fee_value
      when abs(pay.amount-pay.net_amount)<=0.02 then 0
      else 0
    end),2)::numeric(14,2) as package_fee_total,
    bool_and(pay.fee_value is not null or abs(pay.amount-pay.net_amount)<=0.02) as package_fee_source_known,
    count(*)::integer as payment_count
  from public.package_payments pay
  group by pay.user_id,pay.package_id
),
active_redemptions as (
  select
    pr.id as redemption_id,
    pr.user_id,
    pr.procedure_item_id_snapshot as procedure_item_id,
    pr.package_id,
    pr.package_item_id,
    pr.quantity,
    pr.created_at as redemption_created_at,
    p.performed_at,
    ppi.quantity_granted,
    ppi.commercial_value_snapshot,
    pkg.source_type,
    pkg.sale_recorded_at,
    pkg.commercial_total_snapshot,
    coalesce(ppf.package_fee_total,0)::numeric(14,2) as package_fee_total,
    coalesce(ppf.package_fee_source_known,true) as package_fee_source_known,
    coalesce(ppf.payment_count,0) as package_payment_count,
    coalesce(sum(pr.quantity) over(
      partition by pr.user_id,pr.package_item_id
      order by p.performed_at,pr.created_at,pr.id
      rows between unbounded preceding and 1 preceding
    ),0)::numeric(12,3) as prior_active_redeemed_qty
  from public.package_redemptions pr
  join public.procedures p
    on p.id=pr.procedure_id_snapshot and p.user_id=pr.user_id
  join public.patient_package_items ppi
    on ppi.id=pr.package_item_id and ppi.user_id=pr.user_id
  join public.patient_packages pkg
    on pkg.id=pr.package_id and pkg.user_id=pr.user_id
  left join package_payment_fees ppf
    on ppf.package_id=pr.package_id and ppf.user_id=pr.user_id
),
redemption_allocations as (
  select
    r.*,
    greatest(least(r.quantity,greatest(r.quantity_granted-r.prior_active_redeemed_qty,0)),0)::numeric(12,3) as allocatable_granted_qty
  from active_redemptions r
),
redemption_economics as (
  select
    r.*,
    case
      when r.source_type='complimentary' then true
      when r.source_type='voucher' then false
      when r.sale_recorded_at is null then false
      when r.commercial_value_snapshot is null or r.quantity_granted<=0 then false
      when r.allocatable_granted_qty<>r.quantity then false
      else true
    end as package_value_known,
    case
      when r.source_type='complimentary' then 0::numeric
      when r.source_type='voucher' then null::numeric
      when r.sale_recorded_at is null then null::numeric
      when r.commercial_value_snapshot is null or r.quantity_granted<=0 then null::numeric
      when r.allocatable_granted_qty<>r.quantity then null::numeric
      else r.commercial_value_snapshot*r.quantity/r.quantity_granted
    end::numeric as package_allocated_value
  from redemption_allocations r
),
package_fee_progress as (
  select
    r.*,
    coalesce(sum(
      case
        when r.package_value_known and r.source_type not in ('complimentary','voucher')
        then coalesce(r.package_allocated_value,0)
        else 0
      end
    ) over(
      partition by r.user_id,r.package_id
      order by r.performed_at,r.redemption_created_at,r.redemption_id
      rows between unbounded preceding and 1 preceding
    ),0)::numeric as prior_package_commercial_value
  from redemption_economics r
),
package_allocations as (
  select
    r.*,
    case
      when r.source_type='complimentary' then true
      when not r.package_value_known then false
      when not r.package_fee_source_known then false
      when r.package_payment_count=0 then false
      when r.commercial_total_snapshot<=0 then false
      else true
    end as package_fee_known,
    case
      when r.source_type='complimentary' then 0::numeric
      when not r.package_value_known then null::numeric
      when not r.package_fee_source_known then null::numeric
      when r.package_payment_count=0 then null::numeric
      when r.commercial_total_snapshot<=0 then null::numeric
      else (
        round(
          round(r.package_fee_total*100)::numeric
          * least(r.prior_package_commercial_value+coalesce(r.package_allocated_value,0),r.commercial_total_snapshot)
          / r.commercial_total_snapshot
        )
        - round(
          round(r.package_fee_total*100)::numeric
          * least(r.prior_package_commercial_value,r.commercial_total_snapshot)
          / r.commercial_total_snapshot
        )
      )::numeric/100
    end::numeric as package_fee_allocated
  from package_fee_progress r
),
facts as (
  select
    d.user_id,
    d.procedure_id,
    d.id as procedure_item_id,
    d.patient_id,
    d.performed_at,
    d.service_id,
    d.name as service_name_snapshot,
    d.qty,
    (d.list_price*d.qty)::numeric as table_value,
    d.final_price as procedure_final_price,
    d.discount as procedure_discount_snapshot,
    d.direct_due,
    d.coverage_value_snapshot,
    (d.cost_snapshot*d.qty)::numeric as direct_cost_value,
    d.cost_snapshot_known as cost_known,
    d.duration_minutes_snapshot,
    (coalesce(d.coverage_value_snapshot,0)>0 or pa.redemption_id is not null) as via_package,
    pa.redemption_id,
    coalesce(pa.package_value_known,coalesce(d.coverage_value_snapshot,0)=0) as package_value_known,
    pa.package_allocated_value,
    d.direct_fee_known,
    d.direct_fee_allocated,
    coalesce(pa.package_fee_known,coalesce(d.coverage_value_snapshot,0)=0) as package_fee_known,
    pa.package_fee_allocated
  from direct_fee_allocated d
  left join package_allocations pa
    on pa.user_id=d.user_id and pa.procedure_item_id=d.id
)
select
  f.user_id,
  f.procedure_id,
  f.procedure_item_id,
  f.patient_id,
  f.performed_at,
  f.service_id,
  f.service_name_snapshot,
  f.qty,
  round(f.table_value,2)::numeric(14,2) as table_value,
  round(f.procedure_final_price,2)::numeric(14,2) as procedure_final_price,
  round(f.procedure_discount_snapshot,2)::numeric(14,2) as procedure_discount_snapshot,
  round(f.direct_due,2)::numeric(14,2) as direct_due_value,
  round(f.coverage_value_snapshot,2)::numeric(14,2) as package_face_coverage_value,
  f.via_package,
  f.package_value_known,
  round(f.direct_due+coalesce(f.package_allocated_value,0),2)::numeric(14,2) as realized_value_calculable,
  case when f.package_value_known then round(f.direct_due+coalesce(f.package_allocated_value,0),2) end::numeric(14,2) as realized_value_full,
  case when f.package_value_known then round(greatest(f.table_value-(f.direct_due+coalesce(f.package_allocated_value,0)),0),2) end::numeric(14,2) as effective_discount_value,
  f.cost_known,
  case when f.cost_known then round(f.direct_cost_value,2) end::numeric(14,2) as direct_cost_value,
  (f.direct_fee_known and f.package_fee_known) as fee_known,
  round(coalesce(f.direct_fee_allocated,0)+coalesce(f.package_fee_allocated,0),2)::numeric(14,2) as attributed_fee_calculable,
  case when f.direct_fee_known and f.package_fee_known then round(coalesce(f.direct_fee_allocated,0)+coalesce(f.package_fee_allocated,0),2) end::numeric(14,2) as attributed_fee_full,
  (f.package_value_known and f.cost_known and f.direct_fee_known and f.package_fee_known) as contribution_known,
  case
    when f.package_value_known and f.cost_known and f.direct_fee_known and f.package_fee_known
    then round((f.direct_due+coalesce(f.package_allocated_value,0))-f.direct_cost_value-(coalesce(f.direct_fee_allocated,0)+coalesce(f.package_fee_allocated,0)),2)
  end::numeric(14,2) as contribution_value,
  f.duration_minutes_snapshot
from facts f;

revoke all on public.service_financial_item_facts_v1 from public,anon;
grant select on public.service_financial_item_facts_v1 to authenticated;
