-- Stage 2: retention sources, independent maintenance cycle and service ticket.
begin;
alter table public.services add column if not exists maintenance_days integer;
alter table public.services drop constraint if exists services_maintenance_days_check;
alter table public.services add constraint services_maintenance_days_check
 check (maintenance_days is null or maintenance_days between 1 and 3650);
update public.services
set maintenance_days=case
 when name ilike '%toxina%' or name ilike '%botox%' then 120
 when name ilike '%preenchimento%' then 270
 when name ilike '%bioestimulador%' then 90
 when name ilike '%limpeza de pele%' and name not ilike '%voucher%' then 45
 else null end
where maintenance_days is null and
 (name ilike '%toxina%' or name ilike '%botox%' or name ilike '%preenchimento%' or name ilike '%bioestimulador%' or (name ilike '%limpeza de pele%' and name not ilike '%voucher%'));

create or replace function public.relationship_service_ticket_v1(p_user_id uuid,p_patient_id uuid,p_service_id uuid)
returns numeric language sql stable security definer set search_path=public,pg_temp
as $$
select case when auth.uid() is null or p_user_id<>auth.uid() or p_patient_id is null or p_service_id is null then null
else coalesce(
 (select round(avg(pi.final_price),2) from public.procedure_items pi
  join public.procedures pr on pr.id=pi.procedure_id and pr.user_id=pi.user_id
  where pr.user_id=p_user_id and pr.patient_id=p_patient_id and pi.service_id=p_service_id
    and pi.final_price>0 and pr.attendance_type<>'return'),
 (select s.price from public.services s where s.id=p_service_id and s.user_id=p_user_id)
) end;
$$;
revoke all on function public.relationship_service_ticket_v1(uuid,uuid,uuid) from public,anon;
grant execute on function public.relationship_service_ticket_v1(uuid,uuid,uuid) to authenticated;

create or replace view public.relationship_opportunity_sources_v1 with (security_invoker=true) as
with params as (select (select auth.uid()) user_id,(now() at time zone 'America/Sao_Paulo')::date today,now() now_at,coalesce((select returns_enabled from public.relationship_preferences where user_id=(select auth.uid())),true) returns_enabled,coalesce((select proposals_enabled from public.relationship_preferences where user_id=(select auth.uid())),true) proposals_enabled,coalesce((select credits_enabled from public.relationship_preferences where user_id=(select auth.uid())),true) credits_enabled,coalesce((select reactivation_enabled from public.relationship_preferences where user_id=(select auth.uid())),true) reactivation_enabled,coalesce((select reactivation_after_days from public.relationship_preferences where user_id=(select auth.uid())),60) reactivation_after_days,coalesce((select recent_contact_cooldown_days from public.relationship_preferences where user_id=(select auth.uid())),7) recent_contact_cooldown_days,coalesce((select proposal_followup_days from public.communication_preferences where user_id=(select auth.uid())),2) proposal_followup_days,coalesce((select package_expiry_days from public.communication_preferences where user_id=(select auth.uid())),15) package_expiry_days),
people as (select pc.* from public.relationship_person_context_v1 pc join params x on x.user_id=pc.user_id),
return_sources as (select p.user_id,p.person_type,p.person_id,p.patient_id,p.contact_id,p.display_name,p.phone,p.last_visit_at,p.next_appointment_at,p.last_contact_at,p.snoozed_until,'return:'||r.id::text opportunity_key,'return'::text opportunity_type,case when r.window_end<x.today then 'return_overdue' when r.window_start<=x.today then 'return_due' else 'return_upcoming' end priority_class,case when r.window_end<x.today then 500 when r.window_start<=x.today then 450 else 350 end priority_rank,((r.window_end::timestamp+time '09:00') at time zone 'America/Sao_Paulo') sort_at,case when r.window_end<x.today then 'Retorno atrasado há '||(x.today-r.window_end)::text||' dia'||case when(x.today-r.window_end)=1 then '' else 's' end when r.window_start<=x.today then 'Retorno disponível' else 'Retorno abre em '||(r.window_start-x.today)::text||' dia'||case when(r.window_start-x.today)=1 then '' else 's' end end label,'procedure_return'::text source_type,r.id source_id,case when r.window_end<x.today then 'overdue' when r.window_start<=x.today then 'due' else 'upcoming' end status,r.window_end due_date,case when r.window_end<x.today then x.today-r.window_end else 0 end age_days,null::numeric amount,null::jsonb remaining,null::date expires_on,'/retornos?patient_id='||r.patient_id::text route,'return:'||r.id::text communication_item_key,'procedure_return'::text template_key,jsonb_build_object('window_start',r.window_start,'window_end',r.window_end,'return_type',r.return_type,'service_name',r.service_name_snapshot) context from public.procedure_returns r join params x on x.user_id=r.user_id and x.returns_enabled join people p on p.user_id=r.user_id and p.person_type='patient' and p.patient_id=r.patient_id left join public.appointments a on a.id=r.appointment_id and a.user_id=r.user_id where r.completed_at is null and r.dismissed_at is null and r.window_start<=x.today+5 and(r.appointment_id is null or a.status in('cancelado','nao_compareceu')) and(r.contacted_at is null or r.contacted_at<=x.now_at-make_interval(days=>x.recent_contact_cooldown_days))),
latest_proposal as (select v.*,row_number() over(partition by v.proposal_id order by v.version_number desc,v.id desc) rn from public.treatment_proposal_versions v join params x on x.user_id=v.user_id),
proposal_sources as (select p.user_id,p.person_type,p.person_id,p.patient_id,p.contact_id,p.display_name,p.phone,p.last_visit_at,p.next_appointment_at,p.last_contact_at,p.snoozed_until,'proposal:'||v.id::text opportunity_key,'proposal'::text opportunity_type,'proposal_followup'::text priority_class,300 priority_rank,greatest(v.sent_at,coalesce(p.last_contact_at,v.sent_at))+make_interval(days=>x.proposal_followup_days) sort_at,'Proposta sem contato recente há '||greatest(0,floor(extract(epoch from(x.now_at-greatest(v.sent_at,coalesce(p.last_contact_at,v.sent_at))))/86400))::int::text||' dia(s)' label,'proposal_version'::text source_type,v.id source_id,'open'::text status,v.valid_until due_date,greatest(0,floor(extract(epoch from(x.now_at-v.sent_at))/86400))::int age_days,v.total_value amount,null::jsonb remaining,v.valid_until expires_on,'/crm/deals/'||d.id::text||'/proposals/'||tp.id::text route,'proposal:'||v.id::text||':followup' communication_item_key,'proposal_followup'::text template_key,jsonb_build_object('proposal_id',tp.id,'deal_id',d.id,'proposal_title',v.title,'total_value',v.total_value,'sent_at',v.sent_at,'valid_until',v.valid_until) context from latest_proposal v join params x on x.user_id=v.user_id and x.proposals_enabled join public.treatment_proposals tp on tp.id=v.proposal_id and tp.user_id=v.user_id join public.deals d on d.id=tp.deal_id and d.user_id=tp.user_id join public.contacts c on c.id=d.contact_id and c.user_id=d.user_id join people p on p.user_id=c.user_id and p.person_type=case when c.patient_id is not null then 'patient' else 'contact' end and p.person_id=coalesce(c.patient_id,c.id) where v.rn=1 and v.status='issued' and v.sent_at is not null and greatest(v.sent_at,coalesce(p.last_contact_at,v.sent_at))+make_interval(days=>x.proposal_followup_days)<=x.now_at),
credit_items as (select b.*,x.today,x.package_expiry_days from public.patient_credit_item_balances_v b join params x on x.user_id=b.user_id and x.credits_enabled where b.package_status='active' and b.raw_balance>0 and(b.valid_from is null or b.valid_from<=x.today) and(b.valid_until is null or b.valid_until>=x.today)),
credit_rollup as (select b.user_id,b.patient_id,b.package_id,max(b.package_title) package_title,max(b.valid_until) valid_until,jsonb_agg(jsonb_build_object('package_item_id',b.package_item_id,'service_name',b.service_name_snapshot,'balance',b.raw_balance,'unit_label',b.unit_label_snapshot) order by b.service_name_snapshot,b.package_item_id) remaining from credit_items b group by b.user_id,b.patient_id,b.package_id),
credit_sources as (select p.user_id,p.person_type,p.person_id,p.patient_id,p.contact_id,p.display_name,p.phone,p.last_visit_at,p.next_appointment_at,p.last_contact_at,p.snoozed_until,'package:'||cr.package_id::text||':expiry' opportunity_key,'credit'::text opportunity_type,case when cr.valid_until is not null and cr.valid_until<=x.today+x.package_expiry_days then 'credit_expiry' else 'credit_available' end priority_class,case when cr.valid_until is not null and cr.valid_until<=x.today+x.package_expiry_days then 400 else 250 end priority_rank,((cr.valid_until::timestamp+time '09:00') at time zone 'America/Sao_Paulo') sort_at,case when cr.valid_until is null then 'Crédito disponível' when cr.valid_until>x.today+x.package_expiry_days then 'Crédito de pacote disponível' when cr.valid_until=x.today then 'Crédito vence hoje' else 'Crédito vence em '||(cr.valid_until-x.today)::text||' dia'||case when(cr.valid_until-x.today)=1 then '' else 's' end end label,'package'::text source_type,cr.package_id source_id,'active'::text status,cr.valid_until due_date,0 age_days,null::numeric amount,cr.remaining,cr.valid_until expires_on,'/pacotes'::text route,'package:'||cr.package_id::text||':expiry' communication_item_key,'package_expiry'::text template_key,jsonb_build_object('package_title',cr.package_title,'valid_until',cr.valid_until) context from credit_rollup cr join params x on x.user_id=cr.user_id join people p on p.user_id=cr.user_id and p.person_type='patient' and p.patient_id=cr.patient_id where p.last_contact_at is null or p.last_contact_at<=x.now_at-make_interval(days=>x.recent_contact_cooldown_days)),
reactivation_sources as (select p.user_id,p.person_type,p.person_id,p.patient_id,p.contact_id,p.display_name,p.phone,p.last_visit_at,p.next_appointment_at,p.last_contact_at,p.snoozed_until,'reactivation:'||p.patient_id::text opportunity_key,'reactivation'::text opportunity_type,'reactivation'::text priority_class,100 priority_rank,p.last_visit_at sort_at,'Sem atendimento há '||(x.today-(p.last_visit_at at time zone 'America/Sao_Paulo')::date)::text||' dias' label,'relationship_patient'::text source_type,p.patient_id source_id,'inactive'::text status,null::date due_date,(x.today-(p.last_visit_at at time zone 'America/Sao_Paulo')::date) age_days,null::numeric amount,null::jsonb remaining,null::date expires_on,'/pacientes/'||p.patient_id::text route,'relationship:patient:'||p.patient_id::text||':reactivation' communication_item_key,'relationship_reactivation'::text template_key,jsonb_build_object('last_visit_at',p.last_visit_at) context from people p join params x on x.user_id=p.user_id and x.reactivation_enabled where p.person_type='patient' and p.last_visit_at is not null and(p.last_visit_at at time zone 'America/Sao_Paulo')::date<=x.today-x.reactivation_after_days and p.next_appointment_at is null and not p.has_active_aftercare and(p.last_contact_at is null or p.last_contact_at<=x.now_at-make_interval(days=>x.recent_contact_cooldown_days)) and not exists(select 1 from public.procedure_returns r where r.user_id=p.user_id and r.patient_id=p.patient_id and r.completed_at is null and r.dismissed_at is null)),

crm_followup_sources as (
  select p.user_id,p.person_type,p.person_id,p.patient_id,p.contact_id,p.display_name,p.phone,p.last_visit_at,p.next_appointment_at,p.last_contact_at,p.snoozed_until,
  'crm-followup:'||f.id::text opportunity_key,'followup'::text opportunity_type,'crm_followup_overdue'::text priority_class,340 priority_rank,
  ((f.due_on::timestamp+time '09:00') at time zone 'America/Sao_Paulo') sort_at,
  'Contato do CRM atrasado há '||(x.today-f.due_on)::text||' dia(s)' label,'crm_followup'::text source_type,f.id source_id,
  'overdue'::text status,f.due_on due_date,(x.today-f.due_on) age_days,d.value amount,null::jsonb remaining,null::date expires_on,
  '/crm'::text route,'crm_followup:'||f.id::text communication_item_key,'crm_followup'::text template_key,
  jsonb_build_object('deal_id',d.id,'service_name',d.title) context
  from public.crm_followups f
  join params x on x.user_id=f.user_id
  join public.deals d on d.id=f.deal_id and d.user_id=f.user_id
  join public.contacts c on c.id=d.contact_id and c.user_id=d.user_id
  join people p on p.user_id=c.user_id and p.person_type=case when c.patient_id is not null then 'patient' else 'contact' end and p.person_id=coalesce(c.patient_id,c.id)
  where f.status='open' and f.due_on<=x.today and d.stage not in ('won','lost')
),
crm_recontact_sources as (
  select p.user_id,p.person_type,p.person_id,p.patient_id,p.contact_id,p.display_name,p.phone,p.last_visit_at,p.next_appointment_at,p.last_contact_at,p.snoozed_until,
  'crm-recontact:'||d.id::text opportunity_key,'followup'::text opportunity_type,'crm_followup_overdue'::text priority_class,335 priority_rank,
  ((d.recontact_on::timestamp+time '09:00') at time zone 'America/Sao_Paulo') sort_at,
  'Retomar contato pendente desde '||to_char(d.recontact_on,'DD/MM/YYYY') label,'relationship_deal'::text source_type,d.id source_id,
  'overdue'::text status,d.recontact_on due_date,(x.today-d.recontact_on) age_days,d.value amount,null::jsonb remaining,null::date expires_on,
  '/crm'::text route,'crm-recontact:'||d.id::text communication_item_key,'crm_followup'::text template_key,
  jsonb_build_object('deal_id',d.id,'service_name',d.title) context
  from public.deals d
  join params x on x.user_id=d.user_id
  join public.contacts c on c.id=d.contact_id and c.user_id=d.user_id
  join people p on p.user_id=c.user_id and p.person_type=case when c.patient_id is not null then 'patient' else 'contact' end and p.person_id=coalesce(c.patient_id,c.id)
  where d.stage not in ('won','lost') and d.recontact_on is not null and d.recontact_on<=x.today
    and not exists(select 1 from public.crm_followups f where f.user_id=d.user_id and f.deal_id=d.id and f.status='open' and f.due_on<=x.today)
),
pending_payment_rollup as (
  select pp.user_id,pp.procedure_id,coalesce(min(pp.scheduled_date),null) due_on,sum(pp.amount) balance
  from public.procedure_payments pp
  join params x on x.user_id=pp.user_id
  where pp.paid_at is null and pp.amount>0
  group by pp.user_id,pp.procedure_id
),
payment_sources as (
  select p.user_id,p.person_type,p.person_id,p.patient_id,p.contact_id,p.display_name,p.phone,p.last_visit_at,p.next_appointment_at,p.last_contact_at,p.snoozed_until,
  'payment:'||pr.id::text opportunity_key,'payment'::text opportunity_type,
  case when pay.due_on<x.today then 'payment_overdue' else 'payment_pending' end priority_class,
  case when pay.due_on<x.today then 310 else 220 end priority_rank,
  ((coalesce(pay.due_on,x.today)::timestamp+time '09:00') at time zone 'America/Sao_Paulo') sort_at,
  case when pay.due_on<x.today then 'Pagamento vencido' else 'Pagamento pendente' end label,
  'procedure_payment'::text source_type,pr.id source_id,
  case when pay.due_on<x.today then 'overdue' else 'pending' end status,
  pay.due_on due_date,greatest(0,x.today-coalesce(pay.due_on,x.today)) age_days,
  pay.balance amount,null::jsonb remaining,null::date expires_on,
  '/financeiro'::text route,'payment:'||pr.id::text communication_item_key,
  'relationship_reactivation'::text template_key,jsonb_build_object('balance',pay.balance,'due_on',pay.due_on) context
  from pending_payment_rollup pay
  join public.procedures pr on pr.id=pay.procedure_id and pr.user_id=pay.user_id and coalesce(pr.pending_amount,0)>0.009
  join people p on p.user_id=pr.user_id and p.person_type='patient' and p.patient_id=pr.patient_id
  join params x on x.user_id=pr.user_id
),

voucher_conversion_sources as (
 select p.user_id,p.person_type,p.person_id,p.patient_id,p.contact_id,p.display_name,p.phone,p.last_visit_at,p.next_appointment_at,p.last_contact_at,p.snoozed_until,
 'voucher-conversion:'||p.patient_id::text opportunity_key,'voucher_conversion'::text opportunity_type,'voucher_conversion'::text priority_class,315 priority_rank,
 v.last_at sort_at,'Voucher sem conversão após 21 dias'::text label,
 'procedure'::text source_type,v.procedure_id source_id,'open'::text status,
 (v.last_at at time zone 'America/Sao_Paulo')::date+21 due_date,
 x.today-((v.last_at at time zone 'America/Sao_Paulo')::date+21) age_days,
 public.relationship_service_ticket_v1(p.user_id,p.patient_id,v.service_id) amount,
 null::jsonb remaining,null::date expires_on,
 '/pacientes/'||p.patient_id::text route,'voucher:'||p.patient_id::text communication_item_key,
 'relationship_reactivation'::text template_key,
 jsonb_build_object('service_id',v.service_id,'service_name',v.service_name) context
 from people p join params x on x.user_id=p.user_id and p.person_type='patient'
 join lateral (
   select max(pr.performed_at) last_at,max(pr.id) procedure_id,
     (array_agg(pi.service_id order by pr.performed_at desc,pi.created_at desc))[1] service_id,
     (array_agg(pi.name order by pr.performed_at desc,pi.created_at desc))[1] service_name,
     count(distinct pr.id) visit_count,
     max(coalesce(pr.total_value,0)) total_value
   from public.procedures pr
   left join public.procedure_items pi on pi.procedure_id=pr.id and pi.user_id=pr.user_id
   where pr.user_id=p.user_id and pr.patient_id=p.patient_id and pr.attendance_type<>'return'
 ) v on v.visit_count=1 and v.total_value<=0
 where v.last_at is not null and (v.last_at at time zone 'America/Sao_Paulo')::date<=x.today-21
),
maintenance_latest as (
 select pr.user_id,pr.patient_id,pi.service_id,pi.name service_name,pr.performed_at,s.maintenance_days,
 row_number() over(partition by pr.user_id,pr.patient_id,pi.service_id
   order by pr.performed_at desc,pi.created_at desc,pi.id desc) rn
 from public.procedures pr
 join public.procedure_items pi on pi.procedure_id=pr.id and pi.user_id=pr.user_id
 join public.services s on s.id=pi.service_id and s.user_id=pr.user_id and s.maintenance_days>0
 join params x on x.user_id=pr.user_id
 where pr.attendance_type<>'return'
),
maintenance_sources as (
 select p.user_id,p.person_type,p.person_id,p.patient_id,p.contact_id,p.display_name,p.phone,p.last_visit_at,p.next_appointment_at,p.last_contact_at,p.snoozed_until,
 'maintenance:'||m.patient_id::text||':'||m.service_id::text opportunity_key,'maintenance_due'::text opportunity_type,
 case when (m.performed_at at time zone 'America/Sao_Paulo')::date+m.maintenance_days<x.today then 'maintenance_overdue' else 'maintenance_upcoming' end priority_class,
 case when (m.performed_at at time zone 'America/Sao_Paulo')::date+m.maintenance_days<x.today then 420 else 280 end priority_rank,
 m.performed_at sort_at,
 case when (m.performed_at at time zone 'America/Sao_Paulo')::date+m.maintenance_days<x.today then 'Manutenção vencida' else 'Manutenção nos próximos 30 dias' end label,
 'service'::text source_type,m.service_id source_id,
 case when (m.performed_at at time zone 'America/Sao_Paulo')::date+m.maintenance_days<x.today then 'overdue' else 'upcoming' end status,
 (m.performed_at at time zone 'America/Sao_Paulo')::date+m.maintenance_days due_date,
 greatest(0,x.today-((m.performed_at at time zone 'America/Sao_Paulo')::date+m.maintenance_days)) age_days,
 public.relationship_service_ticket_v1(m.user_id,m.patient_id,m.service_id) amount,
 null::jsonb remaining,null::date expires_on,
 '/pacientes/'||m.patient_id::text route,'maintenance:'||m.patient_id::text||':'||m.service_id::text communication_item_key,
 'relationship_reactivation'::text template_key,jsonb_build_object('service_id',m.service_id,'service_name',m.service_name,'last_performed_at',m.performed_at) context
 from maintenance_latest m
 join params x on x.user_id=m.user_id
 join people p on p.user_id=m.user_id and p.person_type='patient' and p.patient_id=m.patient_id
 where m.rn=1 and (m.performed_at at time zone 'America/Sao_Paulo')::date+m.maintenance_days<=x.today+30
),
all_sources as(select * from voucher_conversion_sources union all select * from maintenance_sources union all select * from return_sources union all select * from credit_sources union all select * from proposal_sources union all select * from reactivation_sources union all select * from crm_followup_sources union all select * from crm_recontact_sources union all select * from payment_sources)
select s.user_id,s.person_type,s.person_id,s.patient_id,s.contact_id,s.display_name,s.phone,
s.last_visit_at,s.next_appointment_at,s.last_contact_at,s.snoozed_until,s.opportunity_key,s.opportunity_type,
s.priority_class,s.priority_rank,s.sort_at,s.label,s.source_type,s.source_id,s.status,s.due_date,s.age_days,
coalesce(s.amount,
 case when s.patient_id is null then null else
 public.relationship_service_ticket_v1(s.user_id,s.patient_id,
  coalesce(
    nullif(s.context->>'service_id','')::uuid,
    (select pi.service_id from public.procedures pr join public.procedure_items pi on pi.procedure_id=pr.id and pi.user_id=pr.user_id
     where pr.user_id=s.user_id and pr.patient_id=s.patient_id and pi.service_id is not null
     order by pr.performed_at desc,pi.created_at desc limit 1)
  )
 ) end) as amount,
s.remaining,s.expires_on,s.route,s.communication_item_key,s.template_key,s.context
from all_sources s;

revoke all on table public.relationship_opportunity_sources_v1 from public,anon,authenticated;

create or replace function public.get_relationship_opportunity_counts_v2()
returns jsonb
language sql
security definer
set search_path=public,pg_temp
as $$
with session as (select auth.uid() user_id),source as (
  select s.* from public.relationship_opportunity_sources_v1 s join session x on x.user_id is not null and s.user_id=x.user_id
  union all select s.* from public.appointment_recovery_opportunity_sources_v1 s join session x on x.user_id is not null and s.user_id=x.user_id
  union all select s.* from public.birthday_relationship_opportunity_sources_v1 s join session x on x.user_id is not null and s.user_id=x.user_id
),active as (select * from source where snoozed_until is null or snoozed_until<=now()),people as (select distinct person_type,person_id from active)
select jsonb_build_object(
  'total',(select count(*) from people),
  'return',(select count(*) from (select distinct person_type,person_id from active where opportunity_type='return')x),
  'proposal',(select count(*) from (select distinct person_type,person_id from active where opportunity_type='proposal')x),
  'credit',(select count(*) from (select distinct person_type,person_id from active where opportunity_type='credit')x),
  'followup',(select count(*) from (select distinct person_type,person_id from active where opportunity_type='followup')x),
  'payment',(select count(*) from (select distinct person_type,person_id from active where opportunity_type='payment')x),
  'voucher_conversion',(select count(*) from (select distinct person_type,person_id from active where opportunity_type='voucher_conversion')x),
  'maintenance_due',(select count(*) from (select distinct person_type,person_id from active where opportunity_type='maintenance_due')x),
  'reactivation',(select count(*) from (select distinct person_type,person_id from active where opportunity_type='reactivation')x),
  'reschedule',(select count(*) from (select distinct person_type,person_id from active where opportunity_type='reschedule')x),
  'birthday',(select count(*) from (select distinct person_type,person_id from active where opportunity_type='birthday')x),
  'birthday_today',(select count(*) from (select distinct person_type,person_id from active where opportunity_type='birthday' and due_date=(now() at time zone 'America/Sao_Paulo')::date)x),
  'snoozed',(select count(*) from (select distinct person_type,person_id from source where snoozed_until>now())x)
);
$$;
revoke all on function public.get_relationship_opportunity_counts_v2() from public,anon;
grant execute on function public.get_relationship_opportunity_counts_v2() to authenticated;
commit;
