-- Hub Giulia 4.1 — Agenda Recovery / Relacionamento + Comunicação manual
-- Cutover deliberado: a auditoria em 18/08/2026 12:44 BRT encontrou 0 cancelamentos e 0 no-shows.
-- Portanto nenhuma pendência histórica é importada; somente eventos a partir do início do pacote são elegíveis.

alter table public.communication_templates drop constraint communication_templates_template_key_check;
alter table public.communication_templates add constraint communication_templates_template_key_check check (
  template_key=any(array[
    'appointment_confirmation','crm_followup','proposal_followup','procedure_return','package_expiry',
    'aftercare_instructions','post_procedure_checkin','relationship_reactivation','waitlist_slot','appointment_recovery'
  ]::text[])
);

alter table public.communication_messages drop constraint communication_messages_context_check;
alter table public.communication_messages add constraint communication_messages_context_check check (
  context=any(array[
    'appointment_confirmation','crm_followup','procedure_return','proposal_followup','package_expiry',
    'aftercare_instructions','post_procedure_checkin','relationship_reactivation','waitlist_slot','appointment_recovery'
  ]::text[])
);

alter table public.communication_messages drop constraint communication_messages_template_key_check;
alter table public.communication_messages add constraint communication_messages_template_key_check check (
  template_key is null or template_key=any(array[
    'appointment_confirmation','crm_followup','proposal_followup','procedure_return','package_expiry',
    'aftercare_instructions','post_procedure_checkin','relationship_reactivation','waitlist_slot','appointment_recovery'
  ]::text[])
);

alter table public.communication_messages drop constraint communication_messages_context_source_check;
alter table public.communication_messages add constraint communication_messages_context_source_check check (
  (context='appointment_confirmation' and source_type='appointment') or
  (context='crm_followup' and source_type='crm_followup') or
  (context='procedure_return' and source_type='procedure_return') or
  (context='proposal_followup' and source_type='proposal_version') or
  (context='package_expiry' and source_type='package') or
  (context='aftercare_instructions' and source_type='procedure_followup_plan') or
  (context='post_procedure_checkin' and source_type='procedure_followup_task') or
  (context='relationship_reactivation' and source_type='relationship_patient') or
  (context='waitlist_slot' and source_type='relationship_patient') or
  (context='appointment_recovery' and source_type='appointment')
);

create or replace view public.appointment_recovery_opportunity_sources_v1
with (security_invoker=true)
as
with ranked as (
  select
    a.*,
    coalesce(a.canceled_at,a.no_show_at,a.updated_at,a.scheduled_at) as recovery_at,
    row_number() over (
      partition by a.user_id,a.patient_id
      order by coalesce(a.canceled_at,a.no_show_at,a.updated_at,a.scheduled_at) desc,a.id desc
    ) as rn
  from public.appointments a
  where a.user_id=(select auth.uid())
    and a.status in ('cancelado','nao_compareceu')
    and coalesce(a.canceled_at,a.no_show_at,a.updated_at,a.scheduled_at)>=timestamptz '2026-08-18 12:44:00-03'
    and not exists (
      select 1 from public.appointments future
      where future.user_id=a.user_id
        and future.patient_id=a.patient_id
        and future.status in ('pendente','confirmado')
        and future.scheduled_at>now()
    )
    and not exists (
      select 1 from public.appointment_recovery_dismissals d
      where d.user_id=a.user_id and d.appointment_id=a.id
    )
)
select
  pc.user_id,pc.person_type,pc.person_id,pc.patient_id,pc.contact_id,pc.display_name,pc.phone,
  pc.last_visit_at,pc.next_appointment_at,pc.last_contact_at,pc.snoozed_until,
  'recovery:'||a.id::text as opportunity_key,
  'reschedule'::text as opportunity_type,
  case when a.status='nao_compareceu' then 'appointment_no_show_recovery' else 'appointment_cancel_recovery' end::text as priority_class,
  425::integer as priority_rank,
  a.recovery_at as sort_at,
  case when a.status='nao_compareceu' then 'Não compareceu ao atendimento de ' else 'Cancelou o atendimento de ' end
    || to_char(a.scheduled_at at time zone 'America/Sao_Paulo','DD/MM') as label,
  'appointment'::text as source_type,
  a.id as source_id,
  'open'::text as status,
  null::date as due_date,
  greatest(0,floor(extract(epoch from now()-a.recovery_at)/86400))::integer as age_days,
  null::numeric as amount,
  null::jsonb as remaining,
  null::date as expires_on,
  '/agenda?patient_id='||a.patient_id::text||case when a.service_id is null then '' else '&service_id='||a.service_id::text end as route,
  'recovery:appointment:'||a.id::text as communication_item_key,
  'appointment_recovery'::text as template_key,
  jsonb_build_object(
    'appointment_status',a.status,
    'scheduled_at',a.scheduled_at,
    'recovery_at',a.recovery_at,
    'cancellation_reason',a.cancellation_reason,
    'service_id',a.service_id,
    'service_name',s.name
  ) as context
from ranked a
join public.relationship_person_context_v1 pc
  on pc.user_id=a.user_id and pc.person_type='patient' and pc.patient_id=a.patient_id
left join public.services s on s.id=a.service_id and s.user_id=a.user_id
where a.rn=1;

-- Mantém o source privado, como o read model de Relacionamento já existente.
revoke all on public.appointment_recovery_opportunity_sources_v1 from public,anon,authenticated;

create or replace function public.list_relationship_opportunities_v2(
  p_category text default null,
  p_search text default null,
  p_include_snoozed boolean default false,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(
  person_type text,person_id uuid,patient_id uuid,contact_id uuid,display_name text,phone text,
  last_visit_at timestamptz,next_appointment_at timestamptz,last_contact_at timestamptz,
  opportunity_count bigint,highest_priority_type text,opportunities jsonb,snoozed_until timestamptz,target_route text
)
language sql
security definer
set search_path=public,pg_temp
as $$
with session as (select auth.uid() as user_id),
source as (
  select s.* from public.relationship_opportunity_sources_v1 s join session x on x.user_id is not null and s.user_id=x.user_id
  union all
  select s.* from public.appointment_recovery_opportunity_sources_v1 s join session x on x.user_id is not null and s.user_id=x.user_id
),wanted_people as (
  select distinct s.person_type,s.person_id
  from source s
  where (p_category is null or p_category='' or s.opportunity_type=p_category)
    and (
      nullif(btrim(left(coalesce(p_search,''),80)),'') is null
      or s.display_name ilike '%'||btrim(left(p_search,80))||'%'
      or regexp_replace(coalesce(s.phone,''),'\D','','g') like '%'||regexp_replace(btrim(left(p_search,80)),'\D','','g')||'%'
    )
    and (coalesce(p_include_snoozed,false) or s.snoozed_until is null or s.snoozed_until<=now())
),ranked as (
  select s.*,row_number() over(
    partition by s.person_type,s.person_id
    order by s.priority_rank desc,s.sort_at asc nulls last,s.opportunity_key
  ) rn
  from source s join wanted_people w using(person_type,person_id)
)
select
  r.person_type,r.person_id,max(r.patient_id::text)::uuid,max(r.contact_id::text)::uuid,
  max(r.display_name),max(r.phone),max(r.last_visit_at),max(r.next_appointment_at),max(r.last_contact_at),count(*)::bigint,
  max(r.opportunity_type) filter(where r.rn=1),
  jsonb_agg(
    jsonb_build_object(
      'key',r.opportunity_key,'type',r.opportunity_type,'priority_class',r.priority_class,
      'source_type',r.source_type,'source_id',r.source_id,'status',r.status,'label',r.label,
      'due_date',r.due_date,'age_days',r.age_days,'amount',r.amount,'remaining',r.remaining,
      'expires_on',r.expires_on,'route',r.route,'communication_item_key',r.communication_item_key,
      'template_key',r.template_key,'context',r.context
    ) order by r.priority_rank desc,r.sort_at asc nulls last,r.opportunity_key
  ),
  max(r.snoozed_until),
  case when r.person_type='patient' then '/pacientes/'||r.person_id::text else '/crm' end
from ranked r
group by r.person_type,r.person_id
order by max(r.priority_rank) desc,min(r.sort_at) asc nulls last,max(r.display_name)
limit greatest(1,least(coalesce(p_limit,50),100))
offset greatest(coalesce(p_offset,0),0);
$$;

create or replace function public.get_relationship_opportunity_counts_v2()
returns jsonb
language sql
security definer
set search_path=public,pg_temp
as $$
with session as (select auth.uid() as user_id),
source as (
  select s.* from public.relationship_opportunity_sources_v1 s join session x on x.user_id is not null and s.user_id=x.user_id
  union all
  select s.* from public.appointment_recovery_opportunity_sources_v1 s join session x on x.user_id is not null and s.user_id=x.user_id
),active as (
  select * from source where snoozed_until is null or snoozed_until<=now()
),people as (
  select distinct person_type,person_id from active
)
select jsonb_build_object(
  'total',(select count(*) from people),
  'return',(select count(*) from (select distinct person_type,person_id from active where opportunity_type='return') x),
  'proposal',(select count(*) from (select distinct person_type,person_id from active where opportunity_type='proposal') x),
  'credit',(select count(*) from (select distinct person_type,person_id from active where opportunity_type='credit') x),
  'reactivation',(select count(*) from (select distinct person_type,person_id from active where opportunity_type='reactivation') x),
  'reschedule',(select count(*) from (select distinct person_type,person_id from active where opportunity_type='reschedule') x),
  'snoozed',(select count(*) from (select distinct person_type,person_id from source where snoozed_until>now()) x)
);
$$;

create or replace function public.get_relationship_person_v2(p_person_type text,p_person_id uuid)
returns table(
  person_type text,person_id uuid,patient_id uuid,contact_id uuid,display_name text,phone text,
  last_visit_at timestamptz,next_appointment_at timestamptz,last_contact_at timestamptz,
  opportunities jsonb,snoozed_until timestamptz,target_route text
)
language sql
security definer
set search_path=public,pg_temp
as $$
with session as (select auth.uid() as user_id),
source as (
  select s.* from public.relationship_opportunity_sources_v1 s join session x on x.user_id is not null and s.user_id=x.user_id
  union all
  select s.* from public.appointment_recovery_opportunity_sources_v1 s join session x on x.user_id is not null and s.user_id=x.user_id
)
select
  s.person_type,s.person_id,max(s.patient_id::text)::uuid,max(s.contact_id::text)::uuid,
  max(s.display_name),max(s.phone),max(s.last_visit_at),max(s.next_appointment_at),max(s.last_contact_at),
  jsonb_agg(
    jsonb_build_object(
      'key',s.opportunity_key,'type',s.opportunity_type,'priority_class',s.priority_class,
      'source_type',s.source_type,'source_id',s.source_id,'status',s.status,'label',s.label,
      'due_date',s.due_date,'age_days',s.age_days,'amount',s.amount,'remaining',s.remaining,
      'expires_on',s.expires_on,'route',s.route,'communication_item_key',s.communication_item_key,
      'template_key',s.template_key,'context',s.context
    ) order by s.priority_rank desc,s.sort_at asc nulls last,s.opportunity_key
  ),
  max(s.snoozed_until),case when s.person_type='patient' then '/pacientes/'||s.person_id::text else '/crm' end
from source s
where s.person_type=p_person_type and s.person_id=p_person_id
group by s.person_type,s.person_id;
$$;

create or replace function public.dismiss_appointment_recovery_v1(p_appointment_id uuid)
returns boolean
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
declare v_count int;
begin
  if auth.uid() is null then raise exception 'RELATIONSHIP_SESSION_REQUIRED'; end if;
  insert into public.appointment_recovery_dismissals(user_id,appointment_id)
  select auth.uid(),a.id
  from public.appointments a
  where a.id=p_appointment_id
    and a.user_id=auth.uid()
    and a.status in ('cancelado','nao_compareceu')
    and not exists (
      select 1 from public.appointments f
      where f.user_id=a.user_id and f.patient_id=a.patient_id
        and f.status in ('pendente','confirmado') and f.scheduled_at>now()
    )
  on conflict do nothing;
  get diagnostics v_count=row_count;
  return v_count>0 or exists(
    select 1 from public.appointment_recovery_dismissals d
    where d.user_id=auth.uid() and d.appointment_id=p_appointment_id
  );
end $$;

-- Communication writes stay behind validated SECURITY DEFINER RPCs because communication_messages
-- intentionally exposes SELECT-only RLS to authenticated clients. We do not widen direct INSERT grants.
create or replace function public.record_waitlist_manual_contact_v1(
  p_entry_id uuid,
  p_slot_at timestamptz,
  p_recipient_phone text,
  p_message_body text,
  p_idempotency_key uuid
)
returns table(message_id uuid,sent_at timestamptz,was_created boolean)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_uid uuid:=auth.uid();
  v_entry record;
  v_expected text;
  v_received text;
  v_id uuid;
  v_sent timestamptz;
  v_created boolean:=false;
  v_item text;
begin
  if v_uid is null then raise exception 'WAITLIST_SESSION_REQUIRED'; end if;
  if p_entry_id is null or p_slot_at is null or p_idempotency_key is null then raise exception 'WAITLIST_CONTACT_INVALID_INPUT'; end if;
  if nullif(btrim(p_message_body),'') is null or length(p_message_body)>12000 then raise exception 'WAITLIST_CONTACT_MESSAGE_INVALID'; end if;

  select e.patient_id,e.status,e.expires_on,p.phone
    into v_entry
  from public.appointment_waitlist_entries e
  join public.patients p on p.id=e.patient_id and p.user_id=v_uid
  where e.id=p_entry_id and e.user_id=v_uid;
  if not found or v_entry.status<>'active'
    or (v_entry.expires_on is not null and v_entry.expires_on<(now() at time zone 'America/Sao_Paulo')::date)
  then raise exception 'WAITLIST_ENTRY_NOT_ACTIVE'; end if;

  v_expected:=public.communication_whatsapp_digits_v1(v_entry.phone);
  v_received:=public.communication_whatsapp_digits_v1(p_recipient_phone);
  if v_expected is null or v_received is null or v_expected<>v_received then raise exception 'WAITLIST_CONTACT_PHONE_INVALID'; end if;

  v_item:='waitlist:'||p_entry_id::text||':'||to_char(p_slot_at at time zone 'UTC','YYYYMMDDHH24MI');
  insert into public.communication_messages(
    user_id,patient_id,channel,direction,context,source_type,source_id,item_key,template_key,
    recipient_phone_snapshot,message_body_snapshot,status,sent_at,idempotency_key
  ) values (
    v_uid,v_entry.patient_id,'whatsapp','outbound','waitlist_slot','relationship_patient',v_entry.patient_id,v_item,'waitlist_slot',
    v_expected,p_message_body,'sent_manual',now(),p_idempotency_key
  )
  on conflict(user_id,idempotency_key) do nothing
  returning id,communication_messages.sent_at into v_id,v_sent;

  if v_id is not null then
    v_created:=true;
    insert into public.communication_attention_state(user_id,item_key,last_contacted_at,snoozed_until)
    values(v_uid,v_item,v_sent,null)
    on conflict(user_id,item_key) do update
      set last_contacted_at=excluded.last_contacted_at,snoozed_until=null,updated_at=now();
  else
    select m.id,m.sent_at into v_id,v_sent
    from public.communication_messages m
    where m.user_id=v_uid and m.idempotency_key=p_idempotency_key;
  end if;
  return query select v_id,v_sent,v_created;
end $$;

create or replace function public.record_appointment_recovery_contact_v1(
  p_appointment_id uuid,
  p_recipient_phone text,
  p_message_body text,
  p_idempotency_key uuid
)
returns table(message_id uuid,sent_at timestamptz,was_created boolean)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_uid uuid:=auth.uid();
  v_appt record;
  v_expected text;
  v_received text;
  v_id uuid;
  v_sent timestamptz;
  v_created boolean:=false;
  v_item text;
begin
  if v_uid is null then raise exception 'RELATIONSHIP_SESSION_REQUIRED'; end if;
  if p_appointment_id is null or p_idempotency_key is null then raise exception 'RECOVERY_CONTACT_INVALID_INPUT'; end if;
  if nullif(btrim(p_message_body),'') is null or length(p_message_body)>12000 then raise exception 'RECOVERY_CONTACT_MESSAGE_INVALID'; end if;

  select a.patient_id,a.status,p.phone
    into v_appt
  from public.appointments a
  join public.patients p on p.id=a.patient_id and p.user_id=v_uid
  where a.id=p_appointment_id and a.user_id=v_uid;
  if not found or v_appt.status not in ('cancelado','nao_compareceu') then raise exception 'RECOVERY_APPOINTMENT_NOT_ELIGIBLE'; end if;
  if exists(
    select 1 from public.appointments f
    where f.user_id=v_uid and f.patient_id=v_appt.patient_id
      and f.status in ('pendente','confirmado') and f.scheduled_at>now()
  ) then raise exception 'RECOVERY_ALREADY_RESCHEDULED'; end if;

  v_expected:=public.communication_whatsapp_digits_v1(v_appt.phone);
  v_received:=public.communication_whatsapp_digits_v1(p_recipient_phone);
  if v_expected is null or v_received is null or v_expected<>v_received then raise exception 'RECOVERY_CONTACT_PHONE_INVALID'; end if;

  v_item:='recovery:appointment:'||p_appointment_id::text;
  insert into public.communication_messages(
    user_id,patient_id,channel,direction,context,source_type,source_id,item_key,template_key,
    recipient_phone_snapshot,message_body_snapshot,status,sent_at,idempotency_key
  ) values (
    v_uid,v_appt.patient_id,'whatsapp','outbound','appointment_recovery','appointment',p_appointment_id,v_item,'appointment_recovery',
    v_expected,p_message_body,'sent_manual',now(),p_idempotency_key
  )
  on conflict(user_id,idempotency_key) do nothing
  returning id,communication_messages.sent_at into v_id,v_sent;

  if v_id is not null then
    v_created:=true;
    insert into public.communication_attention_state(user_id,item_key,last_contacted_at,snoozed_until)
    values(v_uid,v_item,v_sent,null)
    on conflict(user_id,item_key) do update
      set last_contacted_at=excluded.last_contacted_at,snoozed_until=null,updated_at=now();
  else
    select m.id,m.sent_at into v_id,v_sent
    from public.communication_messages m
    where m.user_id=v_uid and m.idempotency_key=p_idempotency_key;
  end if;
  return query select v_id,v_sent,v_created;
end $$;

revoke all on function public.list_relationship_opportunities_v2(text,text,boolean,integer,integer) from public,anon;
revoke all on function public.get_relationship_opportunity_counts_v2() from public,anon;
revoke all on function public.get_relationship_person_v2(text,uuid) from public,anon;
revoke all on function public.dismiss_appointment_recovery_v1(uuid) from public,anon;
revoke all on function public.record_waitlist_manual_contact_v1(uuid,timestamptz,text,text,uuid) from public,anon;
revoke all on function public.record_appointment_recovery_contact_v1(uuid,text,text,uuid) from public,anon;

grant execute on function public.list_relationship_opportunities_v2(text,text,boolean,integer,integer) to authenticated;
grant execute on function public.get_relationship_opportunity_counts_v2() to authenticated;
grant execute on function public.get_relationship_person_v2(text,uuid) to authenticated;
grant execute on function public.dismiss_appointment_recovery_v1(uuid) to authenticated;
grant execute on function public.record_waitlist_manual_contact_v1(uuid,timestamptz,text,text,uuid) to authenticated;
grant execute on function public.record_appointment_recovery_contact_v1(uuid,text,text,uuid) to authenticated;
