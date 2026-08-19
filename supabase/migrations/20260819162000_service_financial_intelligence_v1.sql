-- Hub Giulia 4.4 — Inteligência Financeira por Serviço
-- Additive snapshots + owner-scoped, realization-based read models.

alter table public.services
  add column if not exists cost_is_configured boolean not null default false;

alter table public.procedure_items
  add column if not exists cost_snapshot_known boolean not null default false,
  add column if not exists duration_minutes_snapshot integer;

alter table public.procedure_items
  drop constraint if exists procedure_items_duration_snapshot_check;

alter table public.procedure_items
  add constraint procedure_items_duration_snapshot_check
  check (duration_minutes_snapshot is null or duration_minutes_snapshot > 0);

create or replace function public.snapshot_service_financial_inputs_v1()
returns trigger
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
declare
  v_cost_known boolean;
  v_duration integer;
begin
  select s.cost_is_configured, s.duration_minutes
    into v_cost_known, v_duration
  from public.services s
  where s.id=new.service_id
    and s.user_id=new.user_id;

  new.cost_snapshot_known:=coalesce(v_cost_known,false);
  if new.duration_minutes_snapshot is null and coalesce(v_duration,0)>0 then
    new.duration_minutes_snapshot:=v_duration;
  end if;
  return new;
end;
$$;

revoke all on function public.snapshot_service_financial_inputs_v1() from public,anon,authenticated;

drop trigger if exists procedure_items_financial_snapshot_v1 on public.procedure_items;
create trigger procedure_items_financial_snapshot_v1
before insert on public.procedure_items
for each row execute function public.snapshot_service_financial_inputs_v1();

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
package_allocations as (
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
    end::numeric as package_allocated_value,
    case
      when r.source_type='complimentary' then true
      when r.source_type='voucher' then false
      when r.sale_recorded_at is null then false
      when r.commercial_value_snapshot is null or r.quantity_granted<=0 then false
      when r.allocatable_granted_qty<>r.quantity then false
      when not r.package_fee_source_known then false
      when r.package_payment_count=0 then false
      when r.commercial_total_snapshot<=0 then false
      else true
    end as package_fee_known,
    case
      when r.source_type='complimentary' then 0::numeric
      when r.source_type='voucher' then null::numeric
      when r.sale_recorded_at is null then null::numeric
      when r.commercial_value_snapshot is null or r.quantity_granted<=0 then null::numeric
      when r.allocatable_granted_qty<>r.quantity then null::numeric
      when not r.package_fee_source_known then null::numeric
      when r.package_payment_count=0 then null::numeric
      when r.commercial_total_snapshot<=0 then null::numeric
      else r.package_fee_total*(r.commercial_value_snapshot*r.quantity/r.quantity_granted)/r.commercial_total_snapshot
    end::numeric as package_fee_allocated
  from redemption_allocations r
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

create or replace function public.get_service_financial_summary_v1(
  p_date_from date,
  p_date_to date
)
returns table(
  realizations bigint,
  unique_patients bigint,
  valued_realizations bigint,
  cost_known_realizations bigint,
  fee_known_realizations bigint,
  contribution_known_realizations bigint,
  duration_known_realizations bigint,
  package_realizations bigint,
  unvalued_package_realizations bigint,
  table_value numeric,
  realized_value numeric,
  discount_value numeric,
  direct_cost_value numeric,
  attributed_fee_value numeric,
  contribution_value numeric,
  margin_pct numeric,
  duration_minutes numeric,
  contribution_per_hour numeric,
  valuation_coverage_pct numeric,
  cost_coverage_pct numeric,
  fee_coverage_pct numeric,
  contribution_coverage_pct numeric,
  duration_coverage_pct numeric
)
language plpgsql
stable
security invoker
set search_path=public,pg_temp
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
begin
  if p_date_from is null or p_date_to is null or p_date_to<p_date_from then
    raise exception using errcode='22023',message='SERVICE_FINANCE_PERIOD_INVALID';
  end if;
  if p_date_to-p_date_from>366 then
    raise exception using errcode='22023',message='SERVICE_FINANCE_PERIOD_TOO_LARGE';
  end if;
  v_start:=(p_date_from::timestamp at time zone 'America/Sao_Paulo');
  v_end:=((p_date_to+1)::timestamp at time zone 'America/Sao_Paulo');

  return query
  with scoped as (
    select * from public.service_financial_item_facts_v1 f
    where f.user_id=auth.uid() and f.performed_at>=v_start and f.performed_at<v_end
  ), a as (
    select
      count(*)::bigint realizations,
      count(distinct patient_id)::bigint unique_patients,
      count(*) filter(where package_value_known)::bigint valued_realizations,
      count(*) filter(where cost_known)::bigint cost_known_realizations,
      count(*) filter(where fee_known)::bigint fee_known_realizations,
      count(*) filter(where contribution_known)::bigint contribution_known_realizations,
      count(*) filter(where coalesce(duration_minutes_snapshot,0)>0)::bigint duration_known_realizations,
      count(*) filter(where via_package)::bigint package_realizations,
      count(*) filter(where via_package and not package_value_known)::bigint unvalued_package_realizations,
      coalesce(sum(table_value),0)::numeric table_value,
      coalesce(sum(realized_value_calculable),0)::numeric realized_value,
      coalesce(sum(effective_discount_value),0)::numeric discount_value,
      coalesce(sum(direct_cost_value),0)::numeric direct_cost_value,
      coalesce(sum(attributed_fee_calculable),0)::numeric attributed_fee_value,
      coalesce(sum(contribution_value),0)::numeric contribution_value,
      coalesce(sum(realized_value_full) filter(where contribution_known),0)::numeric contribution_realized_base,
      coalesce(sum(duration_minutes_snapshot) filter(where contribution_known and coalesce(duration_minutes_snapshot,0)>0),0)::numeric contribution_duration,
      coalesce(sum(contribution_value) filter(where contribution_known and coalesce(duration_minutes_snapshot,0)>0),0)::numeric hourly_contribution,
      coalesce(sum(duration_minutes_snapshot) filter(where coalesce(duration_minutes_snapshot,0)>0),0)::numeric duration_minutes
    from scoped
  )
  select
    a.realizations,a.unique_patients,a.valued_realizations,a.cost_known_realizations,a.fee_known_realizations,
    a.contribution_known_realizations,a.duration_known_realizations,a.package_realizations,a.unvalued_package_realizations,
    round(a.table_value,2),round(a.realized_value,2),round(a.discount_value,2),round(a.direct_cost_value,2),
    round(a.attributed_fee_value,2),round(a.contribution_value,2),
    case when a.contribution_realized_base>0 then round(a.contribution_value/a.contribution_realized_base*100,1) end,
    round(a.duration_minutes,0),
    case when a.contribution_duration>0 then round(a.hourly_contribution/(a.contribution_duration/60),2) end,
    case when a.realizations>0 then round(a.valued_realizations::numeric/a.realizations*100,1) else 100::numeric end,
    case when a.realizations>0 then round(a.cost_known_realizations::numeric/a.realizations*100,1) else 100::numeric end,
    case when a.realizations>0 then round(a.fee_known_realizations::numeric/a.realizations*100,1) else 100::numeric end,
    case when a.realizations>0 then round(a.contribution_known_realizations::numeric/a.realizations*100,1) else 100::numeric end,
    case when a.realizations>0 then round(a.duration_known_realizations::numeric/a.realizations*100,1) else 100::numeric end
  from a;
end;
$$;

create or replace function public.list_service_financial_performance_v1(
  p_date_from date,
  p_date_to date,
  p_sort_by text default 'realized_value',
  p_service_id uuid default null
)
returns table(
  service_id uuid,
  service_name text,
  is_archived boolean,
  realizations bigint,
  unique_patients bigint,
  valued_realizations bigint,
  package_realizations bigint,
  unvalued_package_realizations bigint,
  table_value numeric,
  realized_value numeric,
  discount_value numeric,
  average_ticket numeric,
  direct_cost_value numeric,
  attributed_fee_value numeric,
  contribution_value numeric,
  margin_pct numeric,
  duration_minutes numeric,
  contribution_per_hour numeric,
  valuation_coverage_pct numeric,
  cost_coverage_pct numeric,
  fee_coverage_pct numeric,
  contribution_coverage_pct numeric,
  duration_coverage_pct numeric
)
language plpgsql
stable
security invoker
set search_path=public,pg_temp
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
begin
  if p_date_from is null or p_date_to is null or p_date_to<p_date_from then
    raise exception using errcode='22023',message='SERVICE_FINANCE_PERIOD_INVALID';
  end if;
  if p_date_to-p_date_from>366 then
    raise exception using errcode='22023',message='SERVICE_FINANCE_PERIOD_TOO_LARGE';
  end if;
  if p_sort_by not in ('realized_value','contribution','realizations','contribution_per_hour') then
    raise exception using errcode='22023',message='SERVICE_FINANCE_SORT_INVALID';
  end if;
  v_start:=(p_date_from::timestamp at time zone 'America/Sao_Paulo');
  v_end:=((p_date_to+1)::timestamp at time zone 'America/Sao_Paulo');

  return query
  with scoped as (
    select f.*
    from public.service_financial_item_facts_v1 f
    where f.user_id=auth.uid()
      and f.performed_at>=v_start and f.performed_at<v_end
      and (p_service_id is null or f.service_id=p_service_id)
  ), agg as (
    select
      f.service_id,
      coalesce(max(s.name),max(f.service_name_snapshot)) as service_name,
      not coalesce(bool_or(s.active),false) as is_archived,
      count(*)::bigint as realizations,
      count(distinct f.patient_id)::bigint as unique_patients,
      count(*) filter(where f.package_value_known)::bigint as valued_realizations,
      count(*) filter(where f.via_package)::bigint as package_realizations,
      count(*) filter(where f.via_package and not f.package_value_known)::bigint as unvalued_package_realizations,
      coalesce(sum(f.table_value),0)::numeric as table_value,
      coalesce(sum(f.realized_value_calculable),0)::numeric as realized_value,
      coalesce(sum(f.realized_value_full) filter(where f.package_value_known),0)::numeric as ticket_realized_base,
      coalesce(sum(f.effective_discount_value),0)::numeric as discount_value,
      coalesce(sum(f.direct_cost_value),0)::numeric as direct_cost_value,
      coalesce(sum(f.attributed_fee_calculable),0)::numeric as attributed_fee_value,
      coalesce(sum(f.contribution_value),0)::numeric as contribution_value,
      coalesce(sum(f.realized_value_full) filter(where f.contribution_known),0)::numeric as contribution_realized_base,
      count(*) filter(where f.cost_known)::bigint as cost_known_realizations,
      count(*) filter(where f.fee_known)::bigint as fee_known_realizations,
      count(*) filter(where f.contribution_known)::bigint as contribution_known_realizations,
      count(*) filter(where coalesce(f.duration_minutes_snapshot,0)>0)::bigint as duration_known_realizations,
      coalesce(sum(f.duration_minutes_snapshot) filter(where coalesce(f.duration_minutes_snapshot,0)>0),0)::numeric as duration_minutes,
      coalesce(sum(f.duration_minutes_snapshot) filter(where f.contribution_known and coalesce(f.duration_minutes_snapshot,0)>0),0)::numeric as contribution_duration,
      coalesce(sum(f.contribution_value) filter(where f.contribution_known and coalesce(f.duration_minutes_snapshot,0)>0),0)::numeric as hourly_contribution
    from scoped f
    left join public.services s on s.id=f.service_id and s.user_id=f.user_id
    group by f.service_id
  ), shaped as (
    select
      a.service_id,a.service_name,a.is_archived,a.realizations,a.unique_patients,a.valued_realizations,
      a.package_realizations,a.unvalued_package_realizations,
      round(a.table_value,2) as table_value,
      round(a.realized_value,2) as realized_value,
      round(a.discount_value,2) as discount_value,
      case when a.valued_realizations>0 then round(a.ticket_realized_base/a.valued_realizations,2) end as average_ticket,
      round(a.direct_cost_value,2) as direct_cost_value,
      round(a.attributed_fee_value,2) as attributed_fee_value,
      round(a.contribution_value,2) as contribution_value,
      case when a.contribution_realized_base>0 then round(a.contribution_value/a.contribution_realized_base*100,1) end as margin_pct,
      round(a.duration_minutes,0) as duration_minutes,
      case when a.contribution_duration>0 then round(a.hourly_contribution/(a.contribution_duration/60),2) end as contribution_per_hour,
      round(a.valued_realizations::numeric/a.realizations*100,1) as valuation_coverage_pct,
      round(a.cost_known_realizations::numeric/a.realizations*100,1) as cost_coverage_pct,
      round(a.fee_known_realizations::numeric/a.realizations*100,1) as fee_coverage_pct,
      round(a.contribution_known_realizations::numeric/a.realizations*100,1) as contribution_coverage_pct,
      round(a.duration_known_realizations::numeric/a.realizations*100,1) as duration_coverage_pct
    from agg a
  )
  select * from shaped x
  order by
    case when p_sort_by='realized_value' then x.realized_value end desc nulls last,
    case when p_sort_by='contribution' then x.contribution_value end desc nulls last,
    case when p_sort_by='realizations' then x.realizations end desc nulls last,
    case when p_sort_by='contribution_per_hour' then x.contribution_per_hour end desc nulls last,
    x.service_name,x.service_id;
end;
$$;

create or replace function public.get_service_financial_detail_v1(
  p_date_from date,
  p_date_to date,
  p_service_id uuid,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table(
  procedure_id uuid,
  procedure_item_id uuid,
  performed_at timestamptz,
  patient_id uuid,
  patient_name text,
  service_id uuid,
  service_name text,
  qty numeric,
  table_value numeric,
  realized_value numeric,
  discount_value numeric,
  direct_cost_value numeric,
  attributed_fee_value numeric,
  contribution_value numeric,
  duration_minutes integer,
  via_package boolean,
  valuation_known boolean,
  cost_known boolean,
  fee_known boolean,
  contribution_known boolean,
  total_count bigint
)
language plpgsql
stable
security invoker
set search_path=public,pg_temp
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
begin
  if p_date_from is null or p_date_to is null or p_date_to<p_date_from or p_service_id is null then
    raise exception using errcode='22023',message='SERVICE_FINANCE_DETAIL_INVALID';
  end if;
  if p_date_to-p_date_from>366 then
    raise exception using errcode='22023',message='SERVICE_FINANCE_PERIOD_TOO_LARGE';
  end if;
  if p_limit<1 or p_limit>100 or p_offset<0 then
    raise exception using errcode='22023',message='SERVICE_FINANCE_PAGINATION_INVALID';
  end if;
  v_start:=(p_date_from::timestamp at time zone 'America/Sao_Paulo');
  v_end:=((p_date_to+1)::timestamp at time zone 'America/Sao_Paulo');

  return query
  select
    f.procedure_id,f.procedure_item_id,f.performed_at,f.patient_id,p.name,
    f.service_id,coalesce(s.name,f.service_name_snapshot),f.qty,f.table_value,
    f.realized_value_calculable,f.effective_discount_value,f.direct_cost_value,
    f.attributed_fee_calculable,f.contribution_value,f.duration_minutes_snapshot,
    f.via_package,f.package_value_known,f.cost_known,f.fee_known,f.contribution_known,
    count(*) over()::bigint
  from public.service_financial_item_facts_v1 f
  join public.patients p on p.id=f.patient_id and p.user_id=f.user_id
  left join public.services s on s.id=f.service_id and s.user_id=f.user_id
  where f.user_id=auth.uid()
    and f.service_id=p_service_id
    and f.performed_at>=v_start and f.performed_at<v_end
  order by f.performed_at desc,f.procedure_item_id desc
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.get_service_financial_summary_v1(date,date) from public,anon;
revoke all on function public.list_service_financial_performance_v1(date,date,text,uuid) from public,anon;
revoke all on function public.get_service_financial_detail_v1(date,date,uuid,integer,integer) from public,anon;

grant execute on function public.get_service_financial_summary_v1(date,date) to authenticated;
grant execute on function public.list_service_financial_performance_v1(date,date,text,uuid) to authenticated;
grant execute on function public.get_service_financial_detail_v1(date,date,uuid,integer,integer) to authenticated;

comment on function public.get_service_financial_summary_v1(date,date) is 'Hub Giulia 4.4 owner-scoped service financial summary. Direct contribution is not clinic profit.';
comment on function public.list_service_financial_performance_v1(date,date,text,uuid) is 'Hub Giulia 4.4 service financial performance, grouped by stable service_id.';
comment on function public.get_service_financial_detail_v1(date,date,uuid,integer,integer) is 'Hub Giulia 4.4 paginated owner-scoped service financial drilldown.';
