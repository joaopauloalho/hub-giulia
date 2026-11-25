-- Retention panel. Reads paid procedure and package amounts only.
-- Procedure item list prices are not revenue. Does not write existing rows.

begin;

create or replace function public.get_retention_panel_v1()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
with params as (
  select
    (select auth.uid()) as user_id,
    (now() at time zone 'America/Sao_Paulo')::date as today,
    coalesce((
      select rp.reactivation_after_days
      from public.relationship_preferences rp
      where rp.user_id = (select auth.uid())
    ), 45) as threshold_days
),
procedure_paid as (
  select
    pr.patient_id,
    (pr.performed_at at time zone 'America/Sao_Paulo')::date as visit_day,
    pp.amount,
    pp.paid_at
  from public.procedure_payments pp
  join public.procedures pr on pr.id = pp.procedure_id and pr.user_id = pp.user_id
  join params x on x.user_id = pp.user_id
  where x.user_id is not null
    and pp.paid_at is not null
    and pp.amount > 0
),
package_paid as (
  select pk.patient_id, pay.amount, pay.paid_at
  from public.package_payments pay
  join public.patient_packages pk on pk.id = pay.package_id and pk.user_id = pay.user_id
  join params x on x.user_id = pay.user_id
  where x.user_id is not null
    and pay.paid_at is not null
    and pay.amount > 0
),
visit_counts as (
  select patient_id, count(distinct visit_day)::integer as visits
  from procedure_paid
  group by patient_id
),
paid_totals as (
  select patient_id, sum(amount) as paid_total, min(paid_at) as first_paid_at
  from (
    select patient_id, amount, paid_at from procedure_paid
    union all
    select patient_id, amount, paid_at from package_paid
  ) money
  group by patient_id
),
customers as (
  select
    t.patient_id,
    p.name,
    p.acquisition_source,
    t.paid_total,
    t.first_paid_at,
    coalesce(v.visits, 0) as visits
  from paid_totals t
  join public.patients p on p.id = t.patient_id and p.user_id = (select user_id from params)
  left join visit_counts v on v.patient_id = t.patient_id
),
last_visits as (
  select pr.patient_id, max((pr.performed_at at time zone 'America/Sao_Paulo')::date) as last_visit_on
  from public.procedures pr
  join params x on x.user_id = pr.user_id
  where x.user_id is not null
  group by pr.patient_id
),
at_risk as (
  select
    p.id as patient_id,
    p.name,
    lv.last_visit_on,
    (x.today - lv.last_visit_on) as days_since_visit
  from last_visits lv
  join public.patients p on p.id = lv.patient_id and p.user_id = (select user_id from params)
  join params x on true
  where p.archived_at is null
    and lv.last_visit_on <= x.today - x.threshold_days
    and not exists (
      select 1
      from public.appointments a
      where a.user_id = p.user_id
        and a.patient_id = p.id
        and a.status in ('pendente', 'confirmado')
        and (a.scheduled_at at time zone 'America/Sao_Paulo')::date >= x.today
    )
)
select jsonb_build_object(
  'threshold_days', (select threshold_days from params),
  'customers', (select count(*) from customers),
  'returning_customers', (select count(*) from customers where visits >= 2),
  'one_time_customers', (select count(*) from customers where visits < 2),
  'paid_total', coalesce((select sum(paid_total) from customers), 0),
  'returning_paid_total', coalesce((select sum(paid_total) from customers where visits >= 2), 0),
  'at_risk', coalesce((
    select jsonb_agg(jsonb_build_object(
      'patient_id', patient_id,
      'name', name,
      'last_visit_on', last_visit_on,
      'days_since_visit', days_since_visit
    ) order by days_since_visit desc, name)
    from at_risk
  ), '[]'::jsonb),
  'ltv', coalesce((
    select jsonb_agg(jsonb_build_object(
      'patient_id', patient_id,
      'name', name,
      'paid_total', paid_total,
      'visits', visits
    ) order by paid_total desc, name)
    from customers
  ), '[]'::jsonb),
  'cohorts', coalesce((
    select jsonb_agg(jsonb_build_object(
      'month', cohort_month,
      'customers', customers,
      'returned', returned,
      'paid_total', paid_total
    ) order by cohort_month)
    from (
      select
        to_char((first_paid_at at time zone 'America/Sao_Paulo')::date, 'YYYY-MM') as cohort_month,
        count(*)::integer as customers,
        count(*) filter (where visits >= 2)::integer as returned,
        sum(paid_total) as paid_total
      from customers
      where (first_paid_at at time zone 'America/Sao_Paulo')::date >= date '2026-04-01'
      group by 1
    ) cohort_rows
  ), '[]'::jsonb),
  'origins', coalesce((
    select jsonb_agg(jsonb_build_object(
      'source', source,
      'customers', customers,
      'paid_total', paid_total
    ) order by paid_total desc, source)
    from (
      select
        coalesce(acquisition_source, 'not_informed') as source,
        count(*)::integer as customers,
        sum(paid_total) as paid_total
      from customers
      group by 1
    ) origin_rows
  ), '[]'::jsonb)
);
$$;

revoke all on function public.get_retention_panel_v1() from public, anon;
grant execute on function public.get_retention_panel_v1() to authenticated;

comment on function public.get_retention_panel_v1() is
  'Retention facts from paid procedure_payments and package_payments. Ignores session list prices.';

commit;
