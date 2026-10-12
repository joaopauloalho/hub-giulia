-- Patient lifetime profitability (managerial contribution, not accounting net profit).
-- Revenue is the contracted sale, not the timing of cash receipts.
-- Procedure-linked protocols are never sold twice; their session/return costs remain included.
create or replace function public.get_patient_profitability_v1(
  p_patient_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_result jsonb;
begin
  if v_uid is null then
    raise exception using errcode = '28000', message = 'SESSION_REQUIRED';
  end if;
  if not exists (
    select 1 from public.patients
    where id = p_patient_id and user_id = v_uid
  ) then
    raise exception using errcode = 'P0002', message = 'PATIENT_NOT_FOUND';
  end if;
  if (p_date_from is not null and p_date_to is not null and p_date_to < p_date_from)
    or (p_date_from is not null and p_date_to is not null and p_date_to - p_date_from > 366)
    or p_limit not between 1 and 50
    or p_offset < 0 then
    raise exception using errcode = '22023', message = 'INVALID_PROFITABILITY_FILTER';
  end if;

  with scope_procedures as (
    select p.*
    from public.procedures p
    where p.user_id = v_uid
      and p.patient_id = p_patient_id
      and (p_date_from is null or p.performed_at >= (p_date_from::timestamp at time zone 'America/Sao_Paulo'))
      and (p_date_to is null or p.performed_at < ((p_date_to + 1)::timestamp at time zone 'America/Sao_Paulo'))
  ),
  procedure_payments as (
    select pp.procedure_id,
      count(*) as entries,
      coalesce(sum(pp.amount) filter (where pp.paid_at is not null),0)::numeric as received,
      coalesce(sum(pp.amount) filter (where pp.paid_at is null),0)::numeric as pending,
      coalesce(sum(coalesce(pp.fee_value, greatest(pp.amount - pp.net_amount,0))),0)::numeric as fees,
      bool_and(pp.fee_value is not null or abs(pp.amount - pp.net_amount) <= 0.02) as fees_known
    from public.procedure_payments pp
    join scope_procedures p on p.id = pp.procedure_id
    where pp.user_id = v_uid
    group by pp.procedure_id
  ),
  item_quality as (
    select i.procedure_id,
      bool_and(i.cost_snapshot_known) as item_costs_known,
      string_agg(i.name, ', ' order by i.created_at, i.id) as service_names
    from public.procedure_items i
    join scope_procedures p on p.id = i.procedure_id
    where i.user_id = v_uid
    group by i.procedure_id
  ),
  attendance_rows as (
    select p.id, p.performed_at as event_at, 'attendance'::text as kind,
      coalesce(nullif(q.service_names,''),'Atendimento')::text as title,
      (p.attendance_type = 'return') as is_return,
      p.parent_procedure_id,
      coalesce(p.total_value,0)::numeric as sales,
      coalesce(pp.received,0)::numeric as received,
      case when coalesce(pp.entries,0) = 0
        then greatest(coalesce(p.total_value,0) - coalesce(p.barter_value,0),0)
        else coalesce(pp.pending,0) end::numeric as pending,
      coalesce(p.barter_value,0)::numeric as barter,
      coalesce(pp.fees,0)::numeric as fees,
      coalesce(p.total_cost,0)::numeric as costs,
      coalesce(p.clinical_time_cost,0)::numeric as time_cost,
      coalesce(p.clinical_minutes,0)::integer as clinical_minutes,
      (coalesce(p.clinical_cost_applied,false) and coalesce(q.item_costs_known,false)) as cost_known,
      coalesce(pp.fees_known,true) as fees_known
    from scope_procedures p
    left join procedure_payments pp on pp.procedure_id = p.id
    left join item_quality q on q.procedure_id = p.id
  ),
  scope_packages as (
    select pkg.*
    from public.patient_packages pkg
    where pkg.user_id = v_uid
      and pkg.patient_id = p_patient_id
      and pkg.sale_recorded_at is not null
      and pkg.source_type not in ('voucher','complimentary')
      and pkg.source_procedure_id is null
      and pkg.status <> 'voided'
      and (p_date_from is null or pkg.sale_recorded_at >= (p_date_from::timestamp at time zone 'America/Sao_Paulo'))
      and (p_date_to is null or pkg.sale_recorded_at < ((p_date_to + 1)::timestamp at time zone 'America/Sao_Paulo'))
  ),
  package_payments as (
    select pp.package_id,
      count(*) as entries,
      coalesce(sum(pp.amount) filter (where pp.paid_at is not null),0)::numeric as received,
      coalesce(sum(pp.amount) filter (where pp.paid_at is null),0)::numeric as pending,
      coalesce(sum(coalesce(pp.fee_value, greatest(pp.amount - pp.net_amount,0))),0)::numeric as fees,
      bool_and(pp.fee_value is not null or abs(pp.amount - pp.net_amount) <= 0.02) as fees_known
    from public.package_payments pp
    join scope_packages pkg on pkg.id = pp.package_id
    where pp.user_id = v_uid
    group by pp.package_id
  ),
  all_rows as (
    select a.* from attendance_rows a
    union all
    select pkg.id, pkg.sale_recorded_at, 'package'::text, pkg.title_snapshot::text,
      false, null::uuid,
      pkg.commercial_total_snapshot::numeric, coalesce(pp.received,0)::numeric,
      (case when coalesce(pp.entries,0)=0 then pkg.commercial_total_snapshot else coalesce(pp.pending,0) end)::numeric,
      0::numeric, coalesce(pp.fees,0)::numeric, 0::numeric, 0::numeric, 0::integer,
      true, coalesce(pp.fees_known,true)
    from scope_packages pkg
    left join package_payments pp on pp.package_id = pkg.id
  ),
  totals as (
    select
      count(*) filter (where kind='attendance')::integer as attendances,
      count(*) filter (where kind='attendance' and is_return)::integer as returns,
      count(*) filter (where kind='package')::integer as package_sales,
      count(*)::integer as total_rows,
      coalesce(sum(sales),0)::numeric as sales,
      coalesce(sum(received),0)::numeric as received,
      coalesce(sum(pending),0)::numeric as pending,
      coalesce(sum(barter),0)::numeric as barter,
      coalesce(sum(fees),0)::numeric as fees,
      coalesce(sum(costs),0)::numeric as costs,
      coalesce(sum(time_cost),0)::numeric as time_cost,
      coalesce(sum(clinical_minutes),0)::integer as clinical_minutes,
      count(*) filter (where not cost_known or not fees_known)::integer as incomplete_rows
    from all_rows
  ),
  paged as (
    select * from all_rows order by event_at desc,id desc
    limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'attendances',t.attendances,'returns',t.returns,
      'package_sales',t.package_sales,'total_rows',t.total_rows,
      'sales',round(t.sales,2),'received',round(t.received,2),
      'pending',round(t.pending,2),'barter',round(t.barter,2),
      'fees',round(t.fees,2),'costs',round(t.costs,2),
      'materials_and_procedures_cost',round(t.costs-t.time_cost,2),
      'clinical_time_cost',round(t.time_cost,2),
      'clinical_minutes',t.clinical_minutes,
      'contribution',case when t.incomplete_rows=0 then round(t.sales-t.fees-t.costs,2) end,
      'margin_pct',case when t.incomplete_rows=0 and t.sales>0 then round((t.sales-t.fees-t.costs)*100/t.sales,2) end,
      'cash_result',case when t.incomplete_rows=0 then round(t.received-t.fees-t.costs,2) end,
      'complete',t.incomplete_rows=0,'incomplete_rows',t.incomplete_rows
    ),
    'rows',coalesce((select jsonb_agg(jsonb_build_object(
      'id',r.id,'event_at',r.event_at,'kind',r.kind,'title',r.title,
      'is_return',r.is_return,'parent_procedure_id',r.parent_procedure_id,
      'sales',round(r.sales,2),'received',round(r.received,2),
      'pending',round(r.pending,2),'barter',round(r.barter,2),
      'fees',round(r.fees,2),'costs',round(r.costs,2),
      'clinical_time_cost',round(r.time_cost,2),
      'clinical_minutes',r.clinical_minutes,
      'contribution',case when r.cost_known and r.fees_known then round(r.sales-r.fees-r.costs,2) end,
      'complete',r.cost_known and r.fees_known
    ) order by r.event_at desc,r.id desc) from paged r),'[]'::jsonb)
  ) into v_result
  from totals t;
  return v_result;
end;
$function$;

revoke all on function public.get_patient_profitability_v1(uuid,date,date,integer,integer) from public, anon;
grant execute on function public.get_patient_profitability_v1(uuid,date,date,integer,integer) to authenticated;
comment on function public.get_patient_profitability_v1(uuid,date,date,integer,integer) is
  'Patient managerial LTV: completed attendance and independent package sales; cash separated from sales, returns costed, incomplete cost snapshots block margin.';
