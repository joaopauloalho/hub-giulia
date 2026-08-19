-- Hub Giulia 4.4 — qualify source columns inside PL/pgSQL RETURNS TABLE.
-- Output column names are PL/pgSQL variables; every source reference is qualified
-- to prevent ambiguity such as `table_value` resolving to both the output variable
-- and the read-model column.

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
    select f.*
    from public.service_financial_item_facts_v1 f
    where f.user_id=auth.uid()
      and f.performed_at>=v_start
      and f.performed_at<v_end
  ), a as (
    select
      count(*)::bigint as realizations,
      count(distinct f.patient_id)::bigint as unique_patients,
      count(*) filter(where f.package_value_known)::bigint as valued_realizations,
      count(*) filter(where f.cost_known)::bigint as cost_known_realizations,
      count(*) filter(where f.fee_known)::bigint as fee_known_realizations,
      count(*) filter(where f.contribution_known)::bigint as contribution_known_realizations,
      count(*) filter(where coalesce(f.duration_minutes_snapshot,0)>0)::bigint as duration_known_realizations,
      count(*) filter(where f.via_package)::bigint as package_realizations,
      count(*) filter(where f.via_package and not f.package_value_known)::bigint as unvalued_package_realizations,
      coalesce(sum(f.table_value),0)::numeric as table_value,
      coalesce(sum(f.realized_value_calculable),0)::numeric as realized_value,
      coalesce(sum(f.effective_discount_value),0)::numeric as discount_value,
      coalesce(sum(f.direct_cost_value),0)::numeric as direct_cost_value,
      coalesce(sum(f.attributed_fee_calculable),0)::numeric as attributed_fee_value,
      coalesce(sum(f.contribution_value),0)::numeric as contribution_value,
      coalesce(sum(f.realized_value_full) filter(where f.contribution_known),0)::numeric as contribution_realized_base,
      coalesce(sum(f.duration_minutes_snapshot) filter(where f.contribution_known and coalesce(f.duration_minutes_snapshot,0)>0),0)::numeric as contribution_duration,
      coalesce(sum(f.contribution_value) filter(where f.contribution_known and coalesce(f.duration_minutes_snapshot,0)>0),0)::numeric as hourly_contribution,
      coalesce(sum(f.duration_minutes_snapshot) filter(where coalesce(f.duration_minutes_snapshot,0)>0),0)::numeric as duration_minutes
    from scoped f
  )
  select
    a.realizations,
    a.unique_patients,
    a.valued_realizations,
    a.cost_known_realizations,
    a.fee_known_realizations,
    a.contribution_known_realizations,
    a.duration_known_realizations,
    a.package_realizations,
    a.unvalued_package_realizations,
    round(a.table_value,2),
    round(a.realized_value,2),
    round(a.discount_value,2),
    round(a.direct_cost_value,2),
    round(a.attributed_fee_value,2),
    round(a.contribution_value,2),
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

revoke all on function public.get_service_financial_summary_v1(date,date) from public,anon;
grant execute on function public.get_service_financial_summary_v1(date,date) to authenticated;

comment on function public.get_service_financial_summary_v1(date,date) is 'Hub Giulia 4.4 owner-scoped service financial summary. Direct contribution is not clinic profit.';
