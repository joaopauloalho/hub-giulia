-- Stage 4: explicit patient WhatsApp permission; revoked consent suppresses every relationship source.
begin;
alter table public.patients add column if not exists whatsapp_opt_in boolean not null default false;
alter table public.patients add column if not exists opt_in_at timestamptz;
alter table public.patients add column if not exists opt_in_source text;
alter table public.patients add column if not exists whatsapp_opt_out_at timestamptz;
alter table public.patients drop constraint if exists patients_opt_in_source_check;
alter table public.patients add constraint patients_opt_in_source_check
check (opt_in_source is null or opt_in_source in ('ficha','anamnese','presencial','whatsapp','revogacao'));

create or replace function public.set_patient_whatsapp_consent_v1(
 p_patient_id uuid, p_opt_in boolean, p_source text default 'ficha'
)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid();
begin
 if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if p_opt_in is null or p_source not in ('ficha','anamnese','presencial','whatsapp','revogacao') then
   raise exception 'CONSENT_INVALID' using errcode='22023';
 end if;
 update public.patients
 set whatsapp_opt_in=p_opt_in,
     opt_in_at=case when p_opt_in then now() else null end,
     opt_in_source=p_source,
     whatsapp_opt_out_at=case when p_opt_in then null else now() end
 where id=p_patient_id and user_id=v_uid and archived_at is null;
 if not found then raise exception 'PATIENT_NOT_FOUND' using errcode='42501'; end if;
end;
$$;
revoke all on function public.set_patient_whatsapp_consent_v1(uuid,boolean,text) from public,anon;
grant execute on function public.set_patient_whatsapp_consent_v1(uuid,boolean,text) to authenticated;

create or replace view public.relationship_person_context_v1 with (security_invoker=true) as
with params as (select (select auth.uid()) user_id),
linked_contacts as (select c.user_id,c.patient_id,c.id contact_id from public.contacts c join params x on x.user_id=c.user_id where c.patient_id is not null and c.archived_at is null),
last_procedure as (select p.user_id,p.patient_id,max(p.performed_at) last_procedure_at from public.procedures p join params x on x.user_id=p.user_id group by p.user_id,p.patient_id),
legacy_appointment as (select a.user_id,a.patient_id,max(a.scheduled_at) last_realized_appointment_at from public.appointments a join params x on x.user_id=a.user_id where a.status='realizado' group by a.user_id,a.patient_id),
next_appointment as (select a.user_id,a.patient_id,min(a.scheduled_at) next_appointment_at from public.appointments a join params x on x.user_id=a.user_id where a.status in ('pendente','confirmado') and a.scheduled_at>=now() group by a.user_id,a.patient_id),
communication_contact_events as (select m.user_id,case when m.patient_id is not null or c.patient_id is not null then 'patient' else 'contact' end person_type,coalesce(m.patient_id,c.patient_id,m.contact_id) person_id,m.sent_at occurred_at from public.communication_messages m join params x on x.user_id=m.user_id left join public.contacts c on c.id=m.contact_id and c.user_id=m.user_id where m.status='sent_manual' and coalesce(m.patient_id,c.patient_id,m.contact_id) is not null),
crm_contact_events as (select a.user_id,case when c.patient_id is not null then 'patient' else 'contact' end person_type,coalesce(c.patient_id,c.id) person_id,a.occurred_at from public.crm_activities a join params x on x.user_id=a.user_id join public.contacts c on c.id=a.contact_id and c.user_id=a.user_id where a.activity_type='contact' and not(coalesce(a.metadata,'{}'::jsonb)?'communication_message_id')),
real_contact_events as (select * from communication_contact_events union all select * from crm_contact_events),
last_contact as (select user_id,person_type,person_id,max(occurred_at) last_contact_at from real_contact_events group by user_id,person_type,person_id),
aftercare_active as (select distinct fp.user_id,fp.patient_id from public.procedure_followup_plans fp join params x on x.user_id=fp.user_id where fp.status='active' and fp.patient_id is not null and ((fp.instructions_snapshot is not null and fp.manual_delivery_at is null and not exists(select 1 from public.communication_messages m where m.user_id=fp.user_id and m.source_type='procedure_followup_plan' and m.source_id=fp.id and m.context='aftercare_instructions')) or exists(select 1 from public.procedure_followup_tasks t where t.user_id=fp.user_id and t.followup_plan_id=fp.id and t.status='pending'))),
patient_people as (select p.user_id,'patient'::text person_type,p.id person_id,p.id patient_id,lc.contact_id,p.name display_name,p.phone,coalesce(lp.last_procedure_at,la.last_realized_appointment_at) last_visit_at,na.next_appointment_at,rlc.last_contact_at,coalesce(aa.patient_id is not null,false) has_active_aftercare,st.snoozed_until from public.patients p join params x on x.user_id=p.user_id left join linked_contacts lc on lc.user_id=p.user_id and lc.patient_id=p.id left join last_procedure lp on lp.user_id=p.user_id and lp.patient_id=p.id left join legacy_appointment la on la.user_id=p.user_id and la.patient_id=p.id left join next_appointment na on na.user_id=p.user_id and na.patient_id=p.id left join last_contact rlc on rlc.user_id=p.user_id and rlc.person_type='patient' and rlc.person_id=p.id left join aftercare_active aa on aa.user_id=p.user_id and aa.patient_id=p.id left join public.communication_attention_state st on st.user_id=p.user_id and st.item_key='relationship:patient:'||p.id::text where p.archived_at is null and p.whatsapp_opt_out_at is null),
contact_people as (select c.user_id,'contact'::text person_type,c.id person_id,null::uuid patient_id,c.id contact_id,c.name display_name,c.phone,null::timestamptz last_visit_at,null::timestamptz next_appointment_at,rlc.last_contact_at,false has_active_aftercare,st.snoozed_until from public.contacts c join params x on x.user_id=c.user_id left join last_contact rlc on rlc.user_id=c.user_id and rlc.person_type='contact' and rlc.person_id=c.id left join public.communication_attention_state st on st.user_id=c.user_id and st.item_key='relationship:contact:'||c.id::text where c.patient_id is null and c.archived_at is null)
select * from patient_people union all select * from contact_people;
revoke all on table public.relationship_person_context_v1 from public,anon,authenticated;

create or replace function public.list_relationship_opportunities_v2(
  p_category text default null,
  p_search text default null,
  p_include_snoozed boolean default false,
  p_limit integer default 50,
  p_offset integer default 0
) returns table(person_type text,person_id uuid,patient_id uuid,contact_id uuid,display_name text,phone text,last_visit_at timestamptz,next_appointment_at timestamptz,last_contact_at timestamptz,opportunity_count bigint,highest_priority_type text,opportunities jsonb,snoozed_until timestamptz,target_route text)
language sql
security definer
set search_path=public,pg_temp
as $$
with session as (select auth.uid() user_id),
all_sources as (
  select s.* from public.relationship_opportunity_sources_v1 s join session x on x.user_id is not null and s.user_id=x.user_id
  union all
  select s.* from public.appointment_recovery_opportunity_sources_v1 s join session x on x.user_id is not null and s.user_id=x.user_id
  union all
  select s.* from public.birthday_relationship_opportunity_sources_v1 s join session x on x.user_id is not null and s.user_id=x.user_id
),source as (
 select src.* from all_sources src
 where src.patient_id is null or not exists (
   select 1 from public.patients pt where pt.id=src.patient_id and pt.user_id=src.user_id and pt.whatsapp_opt_out_at is not null
 )
),wanted_people as (
  select distinct s.person_type,s.person_id from source s
  where (p_category is null or p_category='' or s.opportunity_type=p_category)
    and (nullif(btrim(left(coalesce(p_search,''),80)),'') is null or s.display_name ilike '%'||btrim(left(p_search,80))||'%' or regexp_replace(coalesce(s.phone,''),'\D','','g') like '%'||regexp_replace(btrim(left(p_search,80)),'\D','','g')||'%')
    and (coalesce(p_include_snoozed,false) or s.snoozed_until is null or s.snoozed_until<=now())
),ranked as (
  select s.*,row_number() over(partition by s.person_type,s.person_id order by s.priority_rank desc,s.sort_at asc nulls last,s.opportunity_key) rn
  from source s join wanted_people w using(person_type,person_id)
)
select r.person_type,r.person_id,max(r.patient_id::text)::uuid,max(r.contact_id::text)::uuid,max(r.display_name),max(r.phone),max(r.last_visit_at),max(r.next_appointment_at),max(r.last_contact_at),count(*)::bigint,
       max(r.opportunity_type) filter(where r.rn=1),
       jsonb_agg(jsonb_build_object('key',r.opportunity_key,'type',r.opportunity_type,'priority_class',r.priority_class,'source_type',r.source_type,'source_id',r.source_id,'status',r.status,'label',r.label,'due_date',r.due_date,'age_days',r.age_days,'amount',r.amount,'remaining',r.remaining,'expires_on',r.expires_on,'route',r.route,'communication_item_key',r.communication_item_key,'template_key',r.template_key,'context',r.context) order by r.priority_rank desc,r.sort_at asc nulls last,r.opportunity_key),
       max(r.snoozed_until),case when r.person_type='patient' then '/pacientes/'||r.person_id::text else '/crm' end
from ranked r group by r.person_type,r.person_id
order by max(r.priority_rank) desc,min(r.sort_at) asc nulls last,max(r.display_name)
limit greatest(1,least(coalesce(p_limit,50),100)) offset greatest(coalesce(p_offset,0),0);
$$;
revoke all on function public.list_relationship_opportunities_v2(text,text,boolean,integer,integer) from public,anon;
grant execute on function public.list_relationship_opportunities_v2(text,text,boolean,integer,integer) to authenticated;

create or replace function public.get_relationship_opportunity_counts_v2()
returns jsonb
language sql
security definer
set search_path=public,pg_temp
as $$
with session as (select auth.uid() user_id),all_sources as (
  select s.* from public.relationship_opportunity_sources_v1 s join session x on x.user_id is not null and s.user_id=x.user_id
  union all select s.* from public.appointment_recovery_opportunity_sources_v1 s join session x on x.user_id is not null and s.user_id=x.user_id
  union all select s.* from public.birthday_relationship_opportunity_sources_v1 s join session x on x.user_id is not null and s.user_id=x.user_id
),source as (
 select src.* from all_sources src
 where src.patient_id is null or not exists (
   select 1 from public.patients pt where pt.id=src.patient_id and pt.user_id=src.user_id and pt.whatsapp_opt_out_at is not null
 )
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

-- Consent is checked when recording a contact; do not trust the UI toggle alone.
-- The stage-3 result wrapper is protected against revoked or missing consent.
create or replace function public.relationship_today_opt_in_required_v1(p_patient_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce((select p.whatsapp_opt_in and p.whatsapp_opt_out_at is null
 from public.patients p where p.id=p_patient_id and p.user_id=auth.uid() and p.archived_at is null),false);
$$;
revoke all on function public.relationship_today_opt_in_required_v1(uuid) from public,anon;
grant execute on function public.relationship_today_opt_in_required_v1(uuid) to authenticated;
commit;
