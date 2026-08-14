-- Hub Giulia 3.3 — Dashboard Inteligente
-- Read-only aggregate RPCs. Financial cash is based only on paid payment rows.
-- All functions are SECURITY INVOKER and rely on existing tenant RLS.

create index if not exists dashboard_procedure_payments_user_paid_idx
  on public.procedure_payments (user_id, paid_at)
  include (amount, fee_value, net_amount)
  where paid_at is not null;

create index if not exists dashboard_procedure_payments_user_scheduled_idx
  on public.procedure_payments (user_id, scheduled_date)
  include (amount)
  where paid_at is null;

create index if not exists dashboard_procedures_user_performed_idx
  on public.procedures (user_id, performed_at);

create index if not exists dashboard_deals_user_won_idx
  on public.deals (user_id, won_at)
  where won_at is not null;

create index if not exists dashboard_deals_user_lost_idx
  on public.deals (user_id, lost_at)
  where lost_at is not null;

create index if not exists dashboard_credit_ledger_user_type_created_idx
  on public.patient_credit_ledger (user_id, movement_type, created_at);

create or replace function public.get_dashboard_attention_v1(
  p_today date,
  p_expiry_days integer default 7
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_start timestamptz;
  v_end timestamptz;
  v_expiry_end date;
begin
  if v_user_id is null then raise exception using errcode = 'P0001', message = 'DASHBOARD_SESSION_REQUIRED'; end if;
  if p_today is null then raise exception using errcode = '22023', message = 'DASHBOARD_TODAY_REQUIRED'; end if;
  if p_expiry_days is null or p_expiry_days < 1 or p_expiry_days > 90 then raise exception using errcode = '22023', message = 'DASHBOARD_EXPIRY_DAYS_INVALID'; end if;
  v_start := p_today::timestamp at time zone 'America/Sao_Paulo';
  v_end := (p_today + 1)::timestamp at time zone 'America/Sao_Paulo';
  v_expiry_end := p_today + p_expiry_days;

  return (
    with agenda_today as (
      select count(*)::integer as total,
        count(*) filter (where a.status = 'confirmado')::integer as confirmed,
        count(*) filter (where a.status = 'pendente')::integer as pending,
        count(*) filter (where a.status = 'realizado')::integer as completed,
        count(*) filter (where a.status = 'cancelado')::integer as cancelled,
        count(*) filter (where a.status = 'nao_compareceu')::integer as no_show
      from public.appointments a
      where a.user_id = v_user_id and a.scheduled_at >= v_start and a.scheduled_at < v_end
    ),
    next_appointment as (
      select jsonb_build_object('id', a.id, 'patient_name', p.name, 'scheduled_at', a.scheduled_at, 'service_name', s.name, 'status', a.status) as item
      from public.appointments a
      join public.patients p on p.id = a.patient_id and p.user_id = a.user_id
      left join public.services s on s.id = a.service_id and s.user_id = a.user_id
      where a.user_id = v_user_id and a.scheduled_at >= greatest(v_start, now()) and a.scheduled_at < v_end and a.status in ('pendente', 'confirmado')
      order by a.scheduled_at, a.id limit 1
    ),
    followups as (
      select count(*) filter (where f.due_on < p_today)::integer as overdue,
        count(*) filter (where f.due_on = p_today)::integer as today
      from public.crm_followups f where f.user_id = v_user_id and f.status = 'open'
    ),
    active_returns as (
      select r.* from public.procedure_returns r
      left join public.appointments a on a.id = r.appointment_id and a.user_id = r.user_id
      where r.user_id = v_user_id and r.completed_at is null and r.dismissed_at is null and (r.appointment_id is null or a.status = 'cancelado')
    ),
    returns_attention as (
      select count(*) filter (where r.window_end < p_today)::integer as overdue,
        count(*) filter (where r.window_start <= p_today and r.window_end >= p_today)::integer as today,
        count(*) filter (where r.window_start > p_today and r.window_start <= v_expiry_end)::integer as upcoming
      from active_returns r
    ),
    due_payments as (
      select pp.amount, pp.scheduled_date from public.procedure_payments pp where pp.user_id = v_user_id and pp.paid_at is null
      union all
      select pp.amount, pp.scheduled_date from public.package_payments pp where pp.user_id = v_user_id and pp.paid_at is null
    ),
    payment_attention as (
      select count(*) filter (where scheduled_date < p_today)::integer as overdue_count,
        coalesce(sum(amount) filter (where scheduled_date < p_today), 0)::numeric(14,2) as overdue_value,
        count(*) filter (where scheduled_date = p_today)::integer as today_count,
        coalesce(sum(amount) filter (where scheduled_date = p_today), 0)::numeric(14,2) as today_value
      from due_payments
    ),
    proposal_attention as (
      select count(*)::integer as expiring_count, coalesce(sum(s.total_value), 0)::numeric(14,2) as expiring_value
      from public.treatment_proposal_summary_v s
      where s.user_id = v_user_id and s.effective_status = 'issued' and s.valid_until >= p_today and s.valid_until <= v_expiry_end
    ),
    package_balances as (
      select b.package_id, min(b.valid_until) as valid_until, sum(b.available_balance)::numeric(12,3) as available_balance
      from public.patient_credit_item_balances_v b
      where b.user_id = v_user_id and b.effective_status = 'active'
      group by b.package_id
    ),
    package_attention as (
      select count(*)::integer as expiring_count, coalesce(sum(available_balance), 0)::numeric(12,3) as expiring_units
      from package_balances
      where available_balance > 0 and valid_until is not null and valid_until >= p_today and valid_until <= v_expiry_end
    )
    select jsonb_build_object(
      'today', p_today,
      'expiry_days', p_expiry_days,
      'agenda', jsonb_build_object('total', a.total, 'confirmed', a.confirmed, 'pending', a.pending, 'completed', a.completed, 'cancelled', a.cancelled, 'no_show', a.no_show, 'next_appointment', coalesce((select item from next_appointment), 'null'::jsonb)),
      'crm_followups', jsonb_build_object('overdue', f.overdue, 'today', f.today),
      'returns', jsonb_build_object('overdue', r.overdue, 'today', r.today, 'upcoming', r.upcoming),
      'payments', jsonb_build_object('overdue_count', pay.overdue_count, 'overdue_value', pay.overdue_value, 'today_count', pay.today_count, 'today_value', pay.today_value),
      'proposals', jsonb_build_object('expiring_count', prop.expiring_count, 'expiring_value', prop.expiring_value),
      'packages', jsonb_build_object('expiring_count', pkg.expiring_count, 'expiring_units', pkg.expiring_units)
    )
    from agenda_today a cross join followups f cross join returns_attention r cross join payment_attention pay cross join proposal_attention prop cross join package_attention pkg
  );
end;
$$;

create or replace function public.get_dashboard_overview_v1(
  p_start_date date,
  p_end_date_exclusive date,
  p_previous_start_date date,
  p_previous_end_date_exclusive date
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_start timestamptz;
  v_end timestamptz;
  v_prev_start timestamptz;
  v_prev_end timestamptz;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if v_user_id is null then raise exception using errcode = 'P0001', message = 'DASHBOARD_SESSION_REQUIRED'; end if;
  if p_start_date is null or p_end_date_exclusive is null or p_previous_start_date is null or p_previous_end_date_exclusive is null then raise exception using errcode = '22023', message = 'DASHBOARD_PERIOD_REQUIRED'; end if;
  if p_start_date >= p_end_date_exclusive or p_previous_start_date >= p_previous_end_date_exclusive then raise exception using errcode = '22023', message = 'DASHBOARD_PERIOD_INVALID'; end if;
  v_start := p_start_date::timestamp at time zone 'America/Sao_Paulo';
  v_end := p_end_date_exclusive::timestamp at time zone 'America/Sao_Paulo';
  v_prev_start := p_previous_start_date::timestamp at time zone 'America/Sao_Paulo';
  v_prev_end := p_previous_end_date_exclusive::timestamp at time zone 'America/Sao_Paulo';

  return (
    with paid_cash as (
      select pp.paid_at, pp.amount::numeric as amount, coalesce(pp.fee_value, 0)::numeric as fee_value, pp.net_amount::numeric as net_amount
      from public.procedure_payments pp
      where pp.user_id = v_user_id and pp.paid_at is not null and pp.paid_at >= least(v_prev_start, v_start) and pp.paid_at < greatest(v_prev_end, v_end)
      union all
      select pp.paid_at, pp.amount::numeric, coalesce(pp.fee_value, 0)::numeric, pp.net_amount::numeric
      from public.package_payments pp
      where pp.user_id = v_user_id and pp.paid_at is not null and pp.paid_at >= least(v_prev_start, v_start) and pp.paid_at < greatest(v_prev_end, v_end)
    ),
    finance as (
      select coalesce(sum(amount) filter (where paid_at >= v_start and paid_at < v_end), 0)::numeric(14,2) as received_gross,
        coalesce(sum(fee_value) filter (where paid_at >= v_start and paid_at < v_end), 0)::numeric(14,2) as fees,
        coalesce(sum(net_amount) filter (where paid_at >= v_start and paid_at < v_end), 0)::numeric(14,2) as received_net,
        coalesce(sum(amount) filter (where paid_at >= v_prev_start and paid_at < v_prev_end), 0)::numeric(14,2) as previous_received_gross,
        coalesce(sum(fee_value) filter (where paid_at >= v_prev_start and paid_at < v_prev_end), 0)::numeric(14,2) as previous_fees,
        coalesce(sum(net_amount) filter (where paid_at >= v_prev_start and paid_at < v_prev_end), 0)::numeric(14,2) as previous_received_net
      from paid_cash
    ),
    pending_cash as (
      select pp.amount::numeric as amount, pp.scheduled_date from public.procedure_payments pp where pp.user_id = v_user_id and pp.paid_at is null
      union all select pp.amount::numeric, pp.scheduled_date from public.package_payments pp where pp.user_id = v_user_id and pp.paid_at is null
    ),
    pending as (
      select coalesce(sum(amount), 0)::numeric(14,2) as pending_value, count(*)::integer as pending_count,
        coalesce(sum(amount) filter (where scheduled_date < v_today), 0)::numeric(14,2) as overdue_value,
        count(*) filter (where scheduled_date < v_today)::integer as overdue_count
      from pending_cash
    ),
    contacts_metrics as (
      select count(*) filter (where c.created_at >= v_start and c.created_at < v_end)::integer as current_count,
        count(*) filter (where c.created_at >= v_prev_start and c.created_at < v_prev_end)::integer as previous_count
      from public.contacts c where c.user_id = v_user_id
    ),
    deals_metrics as (
      select count(*) filter (where d.created_at >= v_start and d.created_at < v_end)::integer as created_count,
        count(*) filter (where d.created_at >= v_prev_start and d.created_at < v_prev_end)::integer as previous_created_count,
        count(*) filter (where d.won_at >= v_start and d.won_at < v_end)::integer as won_count,
        count(*) filter (where d.won_at >= v_prev_start and d.won_at < v_prev_end)::integer as previous_won_count,
        count(*) filter (where d.lost_at >= v_start and d.lost_at < v_end)::integer as lost_count,
        count(*) filter (where d.lost_at >= v_prev_start and d.lost_at < v_prev_end)::integer as previous_lost_count
      from public.deals d where d.user_id = v_user_id
    ),
    pipeline as (
      select count(*)::integer as open_count, coalesce(sum(d.value), 0)::numeric(14,2) as open_value,
        jsonb_build_object('new', count(*) filter (where d.stage = 'new')::integer, 'contacted', count(*) filter (where d.stage = 'contacted')::integer, 'assessment_scheduled', count(*) filter (where d.stage = 'assessment_scheduled')::integer, 'proposal_sent', count(*) filter (where d.stage = 'proposal_sent')::integer, 'negotiation', count(*) filter (where d.stage = 'negotiation')::integer) as funnel
      from public.deals d where d.user_id = v_user_id and d.stage not in ('won', 'lost')
    ),
    proposal_metrics as (
      select count(*) filter (where s.issued_at >= v_start and s.issued_at < v_end)::integer as issued_count,
        count(*) filter (where s.sent_at >= v_start and s.sent_at < v_end)::integer as sent_count,
        count(*) filter (where s.accepted_at >= v_start and s.accepted_at < v_end)::integer as accepted_count,
        count(*) filter (where s.declined_at >= v_start and s.declined_at < v_end)::integer as declined_count,
        count(*) filter (where s.effective_status = 'expired' and s.valid_until >= p_start_date and s.valid_until < p_end_date_exclusive)::integer as expired_count,
        coalesce(sum(s.total_value) filter (where s.accepted_at >= v_start and s.accepted_at < v_end), 0)::numeric(14,2) as accepted_value,
        count(*) filter (where s.accepted_at >= v_prev_start and s.accepted_at < v_prev_end)::integer as previous_accepted_count,
        coalesce(sum(s.total_value) filter (where s.accepted_at >= v_prev_start and s.accepted_at < v_prev_end), 0)::numeric(14,2) as previous_accepted_value
      from public.treatment_proposal_summary_v s where s.user_id = v_user_id
    ),
    package_metrics as (
      select count(*) filter (where p.activated_at >= v_start and p.activated_at < v_end)::integer as activated_count,
        count(*) filter (where p.activated_at >= v_prev_start and p.activated_at < v_prev_end)::integer as previous_activated_count
      from public.patient_packages p where p.user_id = v_user_id
    ),
    credit_metrics as (
      select coalesce(sum(l.quantity_delta) filter (where l.movement_type = 'grant' and l.created_at >= v_start and l.created_at < v_end), 0)::numeric(12,3) as granted,
        coalesce(-sum(l.quantity_delta) filter (where l.movement_type = 'redeem' and l.created_at >= v_start and l.created_at < v_end), 0)::numeric(12,3) as redeemed,
        coalesce(sum(l.quantity_delta) filter (where l.movement_type = 'grant' and l.created_at >= v_prev_start and l.created_at < v_prev_end), 0)::numeric(12,3) as previous_granted,
        coalesce(-sum(l.quantity_delta) filter (where l.movement_type = 'redeem' and l.created_at >= v_prev_start and l.created_at < v_prev_end), 0)::numeric(12,3) as previous_redeemed
      from public.patient_credit_ledger l where l.user_id = v_user_id and l.movement_type in ('grant', 'redeem')
    ),
    credit_snapshot as (
      select coalesce(sum(b.available_balance), 0)::numeric(12,3) as available_units,
        count(*) filter (where b.available_balance > 0)::integer as available_items,
        count(distinct b.package_id) filter (where b.available_balance > 0)::integer as available_packages
      from public.patient_credit_item_balances_v b where b.user_id = v_user_id
    ),
    agenda_metrics as (
      select count(*) filter (where a.scheduled_at >= v_start and a.scheduled_at < v_end)::integer as appointments,
        count(*) filter (where a.status = 'realizado' and a.scheduled_at >= v_start and a.scheduled_at < v_end)::integer as completed,
        count(*) filter (where a.status = 'cancelado' and a.scheduled_at >= v_start and a.scheduled_at < v_end)::integer as cancelled,
        count(*) filter (where a.status = 'nao_compareceu' and a.scheduled_at >= v_start and a.scheduled_at < v_end)::integer as no_show,
        count(*) filter (where a.status = 'realizado' and a.scheduled_at >= v_prev_start and a.scheduled_at < v_prev_end)::integer as previous_completed,
        count(*) filter (where a.status = 'nao_compareceu' and a.scheduled_at >= v_prev_start and a.scheduled_at < v_prev_end)::integer as previous_no_show
      from public.appointments a where a.user_id = v_user_id
    ),
    procedure_metrics as (
      select count(*) filter (where p.performed_at >= v_start and p.performed_at < v_end)::integer as performed_count,
        count(*) filter (where p.performed_at >= v_prev_start and p.performed_at < v_prev_end)::integer as previous_performed_count
      from public.procedures p where p.user_id = v_user_id
    ),
    production_metrics as (
      select coalesce(sum(pi.final_price) filter (where p.performed_at >= v_start and p.performed_at < v_end), 0)::numeric(14,2) as production_value,
        coalesce(sum(pi.final_price) filter (where p.performed_at >= v_prev_start and p.performed_at < v_prev_end), 0)::numeric(14,2) as previous_production_value,
        coalesce(sum(pi.qty) filter (where p.performed_at >= v_start and p.performed_at < v_end), 0)::numeric(12,3) as service_units
      from public.procedures p join public.procedure_items pi on pi.procedure_id = p.id and pi.user_id = p.user_id where p.user_id = v_user_id
    ),
    top_services as (
      select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'quantity', x.quantity, 'attendances', x.attendances, 'production_value', x.production_value) order by x.quantity desc, x.name), '[]'::jsonb) as items
      from (
        select pi.name, coalesce(sum(pi.qty), 0)::numeric(12,3) as quantity, count(distinct p.id)::integer as attendances, coalesce(sum(pi.final_price), 0)::numeric(14,2) as production_value
        from public.procedures p join public.procedure_items pi on pi.procedure_id = p.id and pi.user_id = p.user_id
        where p.user_id = v_user_id and p.performed_at >= v_start and p.performed_at < v_end
        group by pi.name order by sum(pi.qty) desc, pi.name limit 5
      ) x
    ),
    return_metrics as (
      select count(*) filter (where r.completed_at >= v_start and r.completed_at < v_end)::integer as completed_count,
        count(*) filter (where r.completed_at >= v_prev_start and r.completed_at < v_prev_end)::integer as previous_completed_count
      from public.procedure_returns r where r.user_id = v_user_id
    )
    select jsonb_build_object(
      'period', jsonb_build_object('start_date', p_start_date, 'end_date_exclusive', p_end_date_exclusive, 'previous_start_date', p_previous_start_date, 'previous_end_date_exclusive', p_previous_end_date_exclusive, 'timezone', 'America/Sao_Paulo'),
      'finance', jsonb_build_object('received_gross', f.received_gross, 'fees', f.fees, 'received_net', f.received_net, 'previous_received_gross', f.previous_received_gross, 'previous_fees', f.previous_fees, 'previous_received_net', f.previous_received_net, 'pending_value', pn.pending_value, 'pending_count', pn.pending_count, 'overdue_value', pn.overdue_value, 'overdue_count', pn.overdue_count),
      'crm', jsonb_build_object('new_leads', c.current_count, 'previous_new_leads', c.previous_count, 'new_opportunities', d.created_count, 'previous_new_opportunities', d.previous_created_count, 'won', d.won_count, 'previous_won', d.previous_won_count, 'lost', d.lost_count, 'previous_lost', d.previous_lost_count, 'conversion_rate', case when d.won_count + d.lost_count = 0 then null else round((d.won_count::numeric * 100) / (d.won_count + d.lost_count), 1) end, 'previous_conversion_rate', case when d.previous_won_count + d.previous_lost_count = 0 then null else round((d.previous_won_count::numeric * 100) / (d.previous_won_count + d.previous_lost_count), 1) end, 'pipeline_open_count', pl.open_count, 'pipeline_open_value', pl.open_value, 'pipeline_funnel', pl.funnel),
      'proposals', jsonb_build_object('issued', prop.issued_count, 'sent', prop.sent_count, 'accepted', prop.accepted_count, 'declined', prop.declined_count, 'expired', prop.expired_count, 'accepted_value', prop.accepted_value, 'previous_accepted', prop.previous_accepted_count, 'previous_accepted_value', prop.previous_accepted_value, 'conversion_rate', case when prop.accepted_count + prop.declined_count = 0 then null else round((prop.accepted_count::numeric * 100) / (prop.accepted_count + prop.declined_count), 1) end),
      'packages', jsonb_build_object('activated', pkg.activated_count, 'previous_activated', pkg.previous_activated_count, 'credits_granted', cr.granted, 'previous_credits_granted', cr.previous_granted, 'credits_redeemed', cr.redeemed, 'previous_credits_redeemed', cr.previous_redeemed, 'credits_available', cs.available_units, 'available_items', cs.available_items, 'available_packages', cs.available_packages),
      'agenda', jsonb_build_object('appointments', ag.appointments, 'completed', ag.completed, 'cancelled', ag.cancelled, 'no_show', ag.no_show, 'attendance_rate', case when ag.completed + ag.no_show = 0 then null else round((ag.completed::numeric * 100) / (ag.completed + ag.no_show), 1) end, 'previous_attendance_rate', case when ag.previous_completed + ag.previous_no_show = 0 then null else round((ag.previous_completed::numeric * 100) / (ag.previous_completed + ag.previous_no_show), 1) end),
      'clinical', jsonb_build_object('attendances', pr.performed_count, 'previous_attendances', pr.previous_performed_count, 'production_value', prod.production_value, 'previous_production_value', prod.previous_production_value, 'service_units', prod.service_units, 'top_services', top.items),
      'returns', jsonb_build_object('completed', ret.completed_count, 'previous_completed', ret.previous_completed_count)
    )
    from finance f cross join pending pn cross join contacts_metrics c cross join deals_metrics d cross join pipeline pl cross join proposal_metrics prop cross join package_metrics pkg cross join credit_metrics cr cross join credit_snapshot cs cross join agenda_metrics ag cross join procedure_metrics pr cross join production_metrics prod cross join top_services top cross join return_metrics ret
  );
end;
$$;

create or replace function public.get_dashboard_series_v1(p_start_date date, p_end_date_exclusive date, p_granularity text default 'day') returns jsonb
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid(); v_start timestamptz; v_end timestamptz; v_bucket_start date; v_step interval;
begin
  if v_user_id is null then raise exception using errcode = 'P0001', message = 'DASHBOARD_SESSION_REQUIRED'; end if;
  if p_start_date is null or p_end_date_exclusive is null or p_start_date >= p_end_date_exclusive then raise exception using errcode = '22023', message = 'DASHBOARD_PERIOD_INVALID'; end if;
  if p_granularity not in ('day', 'week', 'month') then raise exception using errcode = '22023', message = 'DASHBOARD_GRANULARITY_INVALID'; end if;
  v_start := p_start_date::timestamp at time zone 'America/Sao_Paulo';
  v_end := p_end_date_exclusive::timestamp at time zone 'America/Sao_Paulo';
  v_bucket_start := case when p_granularity = 'week' then date_trunc('week', p_start_date::timestamp)::date when p_granularity = 'month' then date_trunc('month', p_start_date::timestamp)::date else p_start_date end;
  v_step := case when p_granularity = 'week' then interval '1 week' when p_granularity = 'month' then interval '1 month' else interval '1 day' end;
  return (
    with buckets as (
      select gs::date as bucket from generate_series(v_bucket_start::timestamp, (p_end_date_exclusive - 1)::timestamp, v_step) gs
    ),
    payments as (
      select date_trunc(p_granularity, pp.paid_at at time zone 'America/Sao_Paulo')::date as bucket, pp.amount::numeric as amount, coalesce(pp.fee_value, 0)::numeric as fee_value, pp.net_amount::numeric as net_amount
      from public.procedure_payments pp where pp.user_id = v_user_id and pp.paid_at is not null and pp.paid_at >= v_start and pp.paid_at < v_end
      union all
      select date_trunc(p_granularity, pp.paid_at at time zone 'America/Sao_Paulo')::date, pp.amount::numeric, coalesce(pp.fee_value, 0)::numeric, pp.net_amount::numeric
      from public.package_payments pp where pp.user_id = v_user_id and pp.paid_at is not null and pp.paid_at >= v_start and pp.paid_at < v_end
    ),
    grouped as (
      select bucket, coalesce(sum(amount), 0)::numeric(14,2) as gross, coalesce(sum(fee_value), 0)::numeric(14,2) as fees, coalesce(sum(net_amount), 0)::numeric(14,2) as net from payments group by bucket
    )
    select coalesce(jsonb_agg(jsonb_build_object('bucket', b.bucket, 'gross', coalesce(g.gross, 0), 'fees', coalesce(g.fees, 0), 'net', coalesce(g.net, 0)) order by b.bucket), '[]'::jsonb)
    from buckets b left join grouped g using (bucket)
  );
end;
$$;

revoke all on function public.get_dashboard_attention_v1(date, integer) from public;
revoke all on function public.get_dashboard_overview_v1(date, date, date, date) from public;
revoke all on function public.get_dashboard_series_v1(date, date, text) from public;
grant execute on function public.get_dashboard_attention_v1(date, integer) to authenticated;
grant execute on function public.get_dashboard_overview_v1(date, date, date, date) to authenticated;
grant execute on function public.get_dashboard_series_v1(date, date, text) to authenticated;
