-- Hub Giulia 3.3 — bound period flows by tenant and relevant dates.
-- Snapshots intentionally remain current-state scans inside the tenant.

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
  v_min_start timestamptz;
  v_max_end timestamptz;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if v_user_id is null then raise exception using errcode = 'P0001', message = 'DASHBOARD_SESSION_REQUIRED'; end if;
  if p_start_date is null or p_end_date_exclusive is null or p_previous_start_date is null or p_previous_end_date_exclusive is null then raise exception using errcode = '22023', message = 'DASHBOARD_PERIOD_REQUIRED'; end if;
  if p_start_date >= p_end_date_exclusive or p_previous_start_date >= p_previous_end_date_exclusive then raise exception using errcode = '22023', message = 'DASHBOARD_PERIOD_INVALID'; end if;

  v_start := p_start_date::timestamp at time zone 'America/Sao_Paulo';
  v_end := p_end_date_exclusive::timestamp at time zone 'America/Sao_Paulo';
  v_prev_start := p_previous_start_date::timestamp at time zone 'America/Sao_Paulo';
  v_prev_end := p_previous_end_date_exclusive::timestamp at time zone 'America/Sao_Paulo';
  v_min_start := least(v_prev_start, v_start);
  v_max_end := greatest(v_prev_end, v_end);

  return (
    with paid_cash as (
      select pp.paid_at, pp.amount::numeric as amount, coalesce(pp.fee_value, 0)::numeric as fee_value, pp.net_amount::numeric as net_amount
      from public.procedure_payments pp
      where pp.user_id = v_user_id and pp.paid_at is not null and pp.paid_at >= v_min_start and pp.paid_at < v_max_end
      union all
      select pp.paid_at, pp.amount::numeric, coalesce(pp.fee_value, 0)::numeric, pp.net_amount::numeric
      from public.package_payments pp
      where pp.user_id = v_user_id and pp.paid_at is not null and pp.paid_at >= v_min_start and pp.paid_at < v_max_end
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
      from public.contacts c
      where c.user_id = v_user_id and c.created_at >= v_min_start and c.created_at < v_max_end
    ),
    deals_metrics as (
      select count(*) filter (where d.created_at >= v_start and d.created_at < v_end)::integer as created_count,
        count(*) filter (where d.created_at >= v_prev_start and d.created_at < v_prev_end)::integer as previous_created_count,
        count(*) filter (where d.won_at >= v_start and d.won_at < v_end)::integer as won_count,
        count(*) filter (where d.won_at >= v_prev_start and d.won_at < v_prev_end)::integer as previous_won_count,
        count(*) filter (where d.lost_at >= v_start and d.lost_at < v_end)::integer as lost_count,
        count(*) filter (where d.lost_at >= v_prev_start and d.lost_at < v_prev_end)::integer as previous_lost_count
      from public.deals d
      where d.user_id = v_user_id
        and ((d.created_at >= v_min_start and d.created_at < v_max_end)
          or (d.won_at >= v_min_start and d.won_at < v_max_end)
          or (d.lost_at >= v_min_start and d.lost_at < v_max_end))
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
      from public.treatment_proposal_summary_v s
      where s.user_id = v_user_id
        and ((s.issued_at >= v_min_start and s.issued_at < v_max_end)
          or (s.sent_at >= v_min_start and s.sent_at < v_max_end)
          or (s.accepted_at >= v_min_start and s.accepted_at < v_max_end)
          or (s.declined_at >= v_min_start and s.declined_at < v_max_end)
          or (s.valid_until >= least(p_previous_start_date, p_start_date) and s.valid_until < greatest(p_previous_end_date_exclusive, p_end_date_exclusive)))
    ),
    package_metrics as (
      select count(*) filter (where p.activated_at >= v_start and p.activated_at < v_end)::integer as activated_count,
        count(*) filter (where p.activated_at >= v_prev_start and p.activated_at < v_prev_end)::integer as previous_activated_count
      from public.patient_packages p
      where p.user_id = v_user_id and p.activated_at >= v_min_start and p.activated_at < v_max_end
    ),
    credit_metrics as (
      select coalesce(sum(l.quantity_delta) filter (where l.movement_type = 'grant' and l.created_at >= v_start and l.created_at < v_end), 0)::numeric(12,3) as granted,
        coalesce(-sum(l.quantity_delta) filter (where l.movement_type = 'redeem' and l.created_at >= v_start and l.created_at < v_end), 0)::numeric(12,3) as redeemed,
        coalesce(sum(l.quantity_delta) filter (where l.movement_type = 'grant' and l.created_at >= v_prev_start and l.created_at < v_prev_end), 0)::numeric(12,3) as previous_granted,
        coalesce(-sum(l.quantity_delta) filter (where l.movement_type = 'redeem' and l.created_at >= v_prev_start and l.created_at < v_prev_end), 0)::numeric(12,3) as previous_redeemed
      from public.patient_credit_ledger l
      where l.user_id = v_user_id and l.movement_type in ('grant', 'redeem') and l.created_at >= v_min_start and l.created_at < v_max_end
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
      from public.appointments a
      where a.user_id = v_user_id and a.scheduled_at >= v_min_start and a.scheduled_at < v_max_end
    ),
    procedure_metrics as (
      select count(*) filter (where p.performed_at >= v_start and p.performed_at < v_end)::integer as performed_count,
        count(*) filter (where p.performed_at >= v_prev_start and p.performed_at < v_prev_end)::integer as previous_performed_count
      from public.procedures p
      where p.user_id = v_user_id and p.performed_at >= v_min_start and p.performed_at < v_max_end
    ),
    production_metrics as (
      select coalesce(sum(pi.final_price) filter (where p.performed_at >= v_start and p.performed_at < v_end), 0)::numeric(14,2) as production_value,
        coalesce(sum(pi.final_price) filter (where p.performed_at >= v_prev_start and p.performed_at < v_prev_end), 0)::numeric(14,2) as previous_production_value,
        coalesce(sum(pi.qty) filter (where p.performed_at >= v_start and p.performed_at < v_end), 0)::numeric(12,3) as service_units
      from public.procedures p join public.procedure_items pi on pi.procedure_id = p.id and pi.user_id = p.user_id
      where p.user_id = v_user_id and p.performed_at >= v_min_start and p.performed_at < v_max_end
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
      from public.list_procedure_returns_v2() r
      where r.completed_at >= v_min_start and r.completed_at < v_max_end
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
