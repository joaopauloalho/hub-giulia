-- Align communication return attention with the canonical Returns semantics:
-- a cancelled linked appointment reopens the return; other linked appointments remain scheduled.
create or replace view public.communication_attention_v1
with (security_invoker = true)
as
with params as (
  select
    (select auth.uid()) as user_id,
    (now() at time zone 'America/Sao_Paulo')::date as today,
    coalesce((select cp.confirmation_lead_hours from public.communication_preferences cp where cp.user_id = (select auth.uid())), 36) as confirmation_lead_hours,
    coalesce((select cp.proposal_followup_days from public.communication_preferences cp where cp.user_id = (select auth.uid())), 2) as proposal_followup_days,
    coalesce((select cp.package_expiry_days from public.communication_preferences cp where cp.user_id = (select auth.uid())), 15) as package_expiry_days
),
appointment_attention as (
  select 'appointment:' || a.id::text || ':confirmation' as item_key,
    'confirmation'::text as category, 'appointment'::text as source_type, a.id as source_id,
    a.patient_id, null::uuid as contact_id, coalesce(p.name, 'Paciente') as display_name, p.phone,
    a.scheduled_at as due_at, a.scheduled_at as event_at,
    'Horário aguardando confirmação'::text as reason,
    case when (a.scheduled_at at time zone 'America/Sao_Paulo')::date = x.today then 'today'
         when (a.scheduled_at at time zone 'America/Sao_Paulo')::date = x.today + 1 then 'tomorrow'
         else 'upcoming' end::text as priority,
    'appointment_confirmation'::text as template_key,
    jsonb_build_object('scheduled_at', a.scheduled_at) as context,
    '/agenda'::text as target_route
  from public.appointments a
  join params x on true
  join public.patients p on p.id = a.patient_id and p.user_id = x.user_id
  where a.user_id = x.user_id and a.status = 'pendente'
    and a.scheduled_at >= (x.today::timestamp at time zone 'America/Sao_Paulo')
    and a.scheduled_at <= now() + make_interval(hours => x.confirmation_lead_hours)
),
crm_attention as (
  select 'crm_followup:' || f.id::text as item_key,
    'crm'::text as category, 'crm_followup'::text as source_type, f.id as source_id,
    c.patient_id, c.id as contact_id, coalesce(c.name, 'Contato') as display_name, c.phone,
    ((f.due_on::timestamp + time '09:00') at time zone 'America/Sao_Paulo') as due_at,
    ((f.due_on::timestamp + time '09:00') at time zone 'America/Sao_Paulo') as event_at,
    case when f.due_on < x.today then 'Follow-up CRM atrasado' else 'Follow-up CRM para hoje' end::text as reason,
    case when f.due_on < x.today then 'overdue' else 'today' end::text as priority,
    'crm_followup'::text as template_key,
    jsonb_build_object('deal_id', d.id, 'deal_title', d.title, 'due_on', f.due_on) as context,
    '/crm'::text as target_route
  from public.crm_followups f
  join params x on true
  join public.deals d on d.id = f.deal_id and d.user_id = x.user_id
  join public.contacts c on c.id = d.contact_id and c.user_id = x.user_id
  where f.user_id = x.user_id and f.status = 'open' and f.due_on <= x.today
),
return_attention as (
  select 'return:' || r.id::text as item_key,
    'return'::text as category, 'procedure_return'::text as source_type, r.id as source_id,
    r.patient_id, null::uuid as contact_id, coalesce(r.patient_name, 'Paciente') as display_name, r.patient_phone as phone,
    ((r.window_start::timestamp + time '09:00') at time zone 'America/Sao_Paulo') as due_at,
    ((r.window_start::timestamp + time '09:00') at time zone 'America/Sao_Paulo') as event_at,
    case when r.window_end < x.today then 'Retorno atrasado'
         when r.window_start <= x.today then 'Retorno disponível'
         else 'Retorno próximo' end::text as reason,
    case when r.window_end < x.today then 'overdue'
         when r.window_start <= x.today then 'today'
         when r.window_start = x.today + 1 then 'tomorrow'
         else 'upcoming' end::text as priority,
    'procedure_return'::text as template_key,
    jsonb_build_object('window_start', r.window_start, 'window_end', r.window_end, 'return_type', r.return_type) as context,
    '/retornos'::text as target_route
  from public.list_procedure_returns_v2() r
  join params x on true
  where r.completed_at is null and r.dismissed_at is null and r.contacted_at is null
    and (r.appointment_id is null or r.appointment_status = 'cancelado')
    and r.window_start <= x.today + 5
),
proposal_attention as (
  select 'proposal:' || v.id::text || ':followup' as item_key,
    'proposal'::text as category, 'proposal_version'::text as source_type, v.id as source_id,
    c.patient_id, c.id as contact_id, coalesce(c.name, 'Contato') as display_name, c.phone,
    v.sent_at + make_interval(days => x.proposal_followup_days) as due_at, v.sent_at as event_at,
    'Proposta aguardando follow-up'::text as reason,
    case when (v.sent_at + make_interval(days => x.proposal_followup_days)) < (x.today::timestamp at time zone 'America/Sao_Paulo') then 'overdue'
         when (v.sent_at + make_interval(days => x.proposal_followup_days)) < ((x.today + 1)::timestamp at time zone 'America/Sao_Paulo') then 'today'
         when (v.sent_at + make_interval(days => x.proposal_followup_days)) < ((x.today + 2)::timestamp at time zone 'America/Sao_Paulo') then 'tomorrow'
         else 'upcoming' end::text as priority,
    'proposal_followup'::text as template_key,
    jsonb_build_object('proposal_id', tp.id, 'deal_id', d.id, 'proposal_title', v.title, 'total_value', v.total_value, 'sent_at', v.sent_at, 'valid_until', v.valid_until) as context,
    '/crm/deals/' || d.id::text || '/proposals/' || tp.id::text as target_route
  from public.treatment_proposal_versions v
  join params x on true
  join public.treatment_proposals tp on tp.id = v.proposal_id and tp.user_id = x.user_id
  join public.deals d on d.id = tp.deal_id and d.user_id = x.user_id
  join public.contacts c on c.id = d.contact_id and c.user_id = x.user_id
  where v.user_id = x.user_id and v.status = 'issued' and v.sent_at is not null
    and (v.valid_until is null or v.valid_until >= x.today)
    and v.sent_at + make_interval(days => x.proposal_followup_days) <= now()
),
package_rollup as (
  select b.user_id, b.patient_id, b.package_id, max(b.package_title) as package_title,
         max(b.valid_until) as valid_until, sum(b.available_balance) as remaining_credits
  from public.patient_credit_item_balances_v b
  join params x on true
  where b.user_id = x.user_id and b.package_status = 'active' and b.valid_until is not null
    and b.valid_until >= x.today and b.valid_until <= x.today + x.package_expiry_days and b.available_balance > 0
  group by b.user_id, b.patient_id, b.package_id
  having sum(b.available_balance) > 0
),
package_attention as (
  select 'package:' || pr.package_id::text || ':expiry' as item_key,
    'package'::text as category, 'package'::text as source_type, pr.package_id as source_id,
    pr.patient_id, null::uuid as contact_id, coalesce(p.name, 'Paciente') as display_name, p.phone,
    ((pr.valid_until::timestamp + time '09:00') at time zone 'America/Sao_Paulo') as due_at,
    ((pr.valid_until::timestamp + time '09:00') at time zone 'America/Sao_Paulo') as event_at,
    'Crédito disponível com validade próxima'::text as reason,
    case when pr.valid_until = x.today then 'today' when pr.valid_until = x.today + 1 then 'tomorrow' else 'upcoming' end::text as priority,
    'package_expiry'::text as template_key,
    jsonb_build_object('package_title', pr.package_title, 'valid_until', pr.valid_until, 'remaining_credits', pr.remaining_credits) as context,
    '/pacotes'::text as target_route
  from package_rollup pr
  join params x on true
  join public.patients p on p.id = pr.patient_id and p.user_id = x.user_id
),
all_attention as (
  select * from appointment_attention
  union all select * from crm_attention
  union all select * from return_attention
  union all select * from proposal_attention
  union all select * from package_attention
)
select a.item_key, a.category, a.source_type, a.source_id, a.patient_id, a.contact_id,
  a.display_name, a.phone, a.due_at, a.event_at, a.reason, a.priority, a.template_key, a.context, a.target_route,
  s.last_contacted_at, s.snoozed_until,
  coalesce(s.snoozed_until > now(), false) as is_snoozed,
  (a.category in ('proposal', 'package') and s.last_contacted_at is not null and s.snoozed_until is null) as is_suppressed_after_contact
from all_attention a
left join public.communication_attention_state s
  on s.user_id = (select auth.uid()) and s.item_key = a.item_key;

revoke all on public.communication_attention_v1 from anon;
grant select on public.communication_attention_v1 to authenticated;
