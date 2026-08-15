alter table public.communication_templates drop constraint if exists communication_templates_template_key_check;
alter table public.communication_templates add constraint communication_templates_template_key_check check (template_key in ('appointment_confirmation','crm_followup','proposal_followup','procedure_return','package_expiry','aftercare_instructions','post_procedure_checkin'));

alter table public.communication_messages drop constraint if exists communication_messages_context_check;
alter table public.communication_messages drop constraint if exists communication_messages_context_source_check;
alter table public.communication_messages drop constraint if exists communication_messages_source_type_check;
alter table public.communication_messages drop constraint if exists communication_messages_template_key_check;
alter table public.communication_messages add constraint communication_messages_context_check check (context in ('appointment_confirmation','crm_followup','procedure_return','proposal_followup','package_expiry','aftercare_instructions','post_procedure_checkin'));
alter table public.communication_messages add constraint communication_messages_source_type_check check (source_type in ('appointment','crm_followup','procedure_return','proposal_version','package','procedure_followup_plan','procedure_followup_task'));
alter table public.communication_messages add constraint communication_messages_template_key_check check (template_key is null or template_key in ('appointment_confirmation','crm_followup','proposal_followup','procedure_return','package_expiry','aftercare_instructions','post_procedure_checkin'));
alter table public.communication_messages add constraint communication_messages_context_source_check check (
  (context='appointment_confirmation' and source_type='appointment') or
  (context='crm_followup' and source_type='crm_followup') or
  (context='procedure_return' and source_type='procedure_return') or
  (context='proposal_followup' and source_type='proposal_version') or
  (context='package_expiry' and source_type='package') or
  (context='aftercare_instructions' and source_type='procedure_followup_plan') or
  (context='post_procedure_checkin' and source_type='procedure_followup_task')
);

create or replace function public.communication_validate_template_v1()
returns trigger language plpgsql set search_path='public','pg_temp' as $$
declare v_match text[]; v_token text;
begin
  for v_match in select regexp_matches(new.body,'\{[A-Za-z_][A-Za-z0-9_]*\}','g') loop
    v_token:=trim(both '{}' from v_match[1]);
    if v_token not in ('first_name','name','date','time','clinic_name','proposal_title','valid_until','package_title','remaining_credits','aftercare_instructions') then raise exception 'COMMUNICATION_TEMPLATE_PLACEHOLDER_INVALID:%',v_token; end if;
  end loop;
  return new;
end; $$;

create or replace function public.record_manual_communication_v1(p_source_type text,p_source_id uuid,p_item_key text,p_context text,p_recipient_phone text,p_message_body text,p_template_key text,p_idempotency_key uuid)
returns table(message_id uuid,patient_id uuid,contact_id uuid,sent_at timestamptz,was_created boolean)
language plpgsql security definer set search_path='public','pg_temp' as $$
declare
  v_user uuid:=auth.uid(); v_patient_id uuid; v_contact_id uuid; v_deal_id uuid; v_phone text;
  v_expected_phone text; v_received_phone text; v_expected_item_key text; v_message_id uuid; v_sent_at timestamptz; v_created boolean:=false;
begin
  if v_user is null then raise exception 'COMMUNICATION_SESSION_REQUIRED'; end if;
  if p_source_id is null or p_idempotency_key is null then raise exception 'COMMUNICATION_INVALID_INPUT'; end if;
  if nullif(btrim(p_message_body),'') is null or length(p_message_body)>12000 then raise exception 'COMMUNICATION_MESSAGE_INVALID'; end if;

  if p_source_type='appointment' and p_context='appointment_confirmation' then
    select a.patient_id,p.phone into v_patient_id,v_phone from public.appointments a join public.patients p on p.id=a.patient_id and p.user_id=v_user where a.id=p_source_id and a.user_id=v_user;
    v_expected_item_key:='appointment:'||p_source_id::text||':confirmation';
  elsif p_source_type='crm_followup' and p_context='crm_followup' then
    select c.patient_id,c.id,d.id,c.phone into v_patient_id,v_contact_id,v_deal_id,v_phone from public.crm_followups f join public.deals d on d.id=f.deal_id and d.user_id=v_user join public.contacts c on c.id=d.contact_id and c.user_id=v_user where f.id=p_source_id and f.user_id=v_user;
    v_expected_item_key:='crm_followup:'||p_source_id::text;
  elsif p_source_type='procedure_return' and p_context='procedure_return' then
    select r.patient_id,p.phone into v_patient_id,v_phone from public.procedure_returns r left join public.patients p on p.id=r.patient_id and p.user_id=v_user where r.id=p_source_id and r.user_id=v_user;
    v_expected_item_key:='return:'||p_source_id::text;
  elsif p_source_type='proposal_version' and p_context='proposal_followup' then
    select c.patient_id,c.id,d.id,c.phone into v_patient_id,v_contact_id,v_deal_id,v_phone from public.treatment_proposal_versions pv join public.treatment_proposals tp on tp.id=pv.proposal_id and tp.user_id=v_user join public.deals d on d.id=tp.deal_id and d.user_id=v_user join public.contacts c on c.id=d.contact_id and c.user_id=v_user where pv.id=p_source_id and pv.user_id=v_user;
    v_expected_item_key:='proposal:'||p_source_id::text||':followup';
  elsif p_source_type='package' and p_context='package_expiry' then
    select pp.patient_id,p.phone into v_patient_id,v_phone from public.patient_packages pp join public.patients p on p.id=pp.patient_id and p.user_id=v_user where pp.id=p_source_id and pp.user_id=v_user;
    v_expected_item_key:='package:'||p_source_id::text||':expiry';
  elsif p_source_type='procedure_followup_plan' and p_context='aftercare_instructions' then
    select fp.patient_id,p.phone into v_patient_id,v_phone from public.procedure_followup_plans fp join public.patients p on p.id=fp.patient_id and p.user_id=v_user where fp.id=p_source_id and fp.user_id=v_user and fp.status='active' and fp.instructions_snapshot is not null;
    v_expected_item_key:='aftercare:'||p_source_id::text||':instructions';
  elsif p_source_type='procedure_followup_task' and p_context='post_procedure_checkin' then
    select t.patient_id,p.phone into v_patient_id,v_phone from public.procedure_followup_tasks t join public.patients p on p.id=t.patient_id and p.user_id=v_user where t.id=p_source_id and t.user_id=v_user and t.status='pending';
    v_expected_item_key:='aftercare_task:'||p_source_id::text;
  else raise exception 'COMMUNICATION_SOURCE_CONTEXT_INVALID'; end if;

  if not found then raise exception 'COMMUNICATION_SOURCE_NOT_FOUND'; end if;
  if p_item_key is distinct from v_expected_item_key then raise exception 'COMMUNICATION_ITEM_KEY_INVALID'; end if;
  v_expected_phone:=public.communication_whatsapp_digits_v1(v_phone); v_received_phone:=public.communication_whatsapp_digits_v1(p_recipient_phone);
  if v_expected_phone is null or v_received_phone is null or v_expected_phone<>v_received_phone then raise exception 'COMMUNICATION_PHONE_INVALID'; end if;

  insert into public.communication_messages(user_id,patient_id,contact_id,channel,direction,context,source_type,source_id,item_key,template_key,recipient_phone_snapshot,message_body_snapshot,status,sent_at,idempotency_key)
  values(v_user,v_patient_id,v_contact_id,'whatsapp','outbound',p_context,p_source_type,p_source_id,p_item_key,p_template_key,v_expected_phone,p_message_body,'sent_manual',now(),p_idempotency_key)
  on conflict (user_id,idempotency_key) do nothing returning id,communication_messages.sent_at into v_message_id,v_sent_at;

  if v_message_id is not null then
    v_created:=true;
    insert into public.communication_attention_state(user_id,item_key,last_contacted_at,snoozed_until) values(v_user,p_item_key,v_sent_at,null)
    on conflict (user_id,item_key) do update set last_contacted_at=excluded.last_contacted_at,snoozed_until=null,updated_at=now();
    if v_contact_id is not null and v_deal_id is not null and p_source_type in ('crm_followup','proposal_version') then
      insert into public.crm_activities(user_id,contact_id,deal_id,activity_type,channel,note,metadata,actor_user_id)
      values(v_user,v_contact_id,v_deal_id,'contact','whatsapp','WhatsApp registrado manualmente pela Central de Comunicação.',jsonb_build_object('communication_message_id',v_message_id,'context',p_context,'source_type',p_source_type,'source_id',p_source_id),v_user);
    end if;
  else select m.id,m.sent_at,m.patient_id,m.contact_id into v_message_id,v_sent_at,v_patient_id,v_contact_id from public.communication_messages m where m.user_id=v_user and m.idempotency_key=p_idempotency_key; end if;
  return query select v_message_id,v_patient_id,v_contact_id,v_sent_at,v_created;
end; $$;

alter table public.communication_messages drop constraint if exists communication_messages_message_body_snapshot_check;
alter table public.communication_messages add constraint communication_messages_message_body_snapshot_check check (length(message_body_snapshot) between 1 and 12000);

create or replace view public.aftercare_communication_attention_v1 with (security_invoker=true) as
with today as (select (now() at time zone 'America/Sao_Paulo')::date as d),
orientation as (
  select 'aftercare:'||fp.id::text||':instructions' as item_key,'aftercare'::text as category,'procedure_followup_plan'::text as source_type,fp.id as source_id,
    fp.patient_id,null::uuid as contact_id,fp.patient_name_snapshot as display_name,p.phone,fp.created_at as due_at,fp.created_at as event_at,'Orientações pós-atendimento pendentes'::text as reason,
    case when fp.performed_on<(select d from today) then 'overdue' when fp.performed_on=(select d from today) then 'today' else 'upcoming' end::text as priority,
    'aftercare_instructions'::text as template_key,
    jsonb_build_object('procedure_id',fp.procedure_id_snapshot,'performed_on',fp.performed_on,'aftercare_instructions',fp.instructions_snapshot,'photo_followup',fp.photo_followup_snapshot) as context,
    case when fp.patient_id is null then '/pacientes' else '/pacientes/'||fp.patient_id::text end as target_route
  from public.procedure_followup_plans fp left join public.patients p on p.id=fp.patient_id and p.user_id=fp.user_id
  where fp.user_id=auth.uid() and fp.status='active' and fp.instructions_snapshot is not null and fp.manual_delivery_at is null
    and not exists(select 1 from public.communication_messages m where m.user_id=fp.user_id and m.source_type='procedure_followup_plan' and m.source_id=fp.id and m.context='aftercare_instructions')
),
checkins as (
  select 'aftercare_task:'||t.id::text as item_key,'aftercare'::text as category,'procedure_followup_task'::text as source_type,t.id as source_id,
    t.patient_id,null::uuid as contact_id,fp.patient_name_snapshot as display_name,p.phone,
    ((t.due_on + time '09:00') at time zone 'America/Sao_Paulo') as due_at,fp.created_at as event_at,
    case when t.requires_professional_review then 'Requer atenção da profissional' when t.due_on<(select d from today) then 'Check-in atrasado' else coalesce(t.label,'Check-in pós-atendimento') end::text as reason,
    case when t.requires_professional_review then 'today' when t.due_on<(select d from today) then 'overdue' else 'today' end::text as priority,
    'post_procedure_checkin'::text as template_key,
    jsonb_build_object('procedure_id',t.procedure_id_snapshot,'due_on',t.due_on,'task_type',t.task_type,'task_label',t.label,'requires_professional_review',t.requires_professional_review,'photo_followup',fp.photo_followup_snapshot) as context,
    case when t.patient_id is null then '/pacientes' else '/pacientes/'||t.patient_id::text end as target_route
  from public.procedure_followup_tasks t join public.procedure_followup_plans fp on fp.id=t.followup_plan_id and fp.user_id=t.user_id and fp.status='active'
  left join public.patients p on p.id=t.patient_id and p.user_id=t.user_id
  where t.user_id=auth.uid() and t.status='pending' and (t.due_on<=(select d from today) or t.requires_professional_review)
),base as (select * from orientation union all select * from checkins)
select b.item_key,b.category,b.source_type,b.source_id,b.patient_id,b.contact_id,b.display_name,b.phone,b.due_at,b.event_at,b.reason,b.priority,b.template_key,b.context,b.target_route,
  st.last_contacted_at,st.snoozed_until,(st.snoozed_until is not null and st.snoozed_until>now()) as is_snoozed,false as is_suppressed_after_contact
from base b left join public.communication_attention_state st on st.user_id=auth.uid() and st.item_key=b.item_key;

revoke all on public.aftercare_communication_attention_v1 from public,anon;
grant select on public.aftercare_communication_attention_v1 to authenticated;

create or replace function public.list_communication_attention_v1(p_category text default null,p_search text default null,p_include_snoozed boolean default false,p_limit integer default 100,p_offset integer default 0)
returns table(item_key text,category text,source_type text,source_id uuid,patient_id uuid,contact_id uuid,display_name text,phone text,due_at timestamptz,event_at timestamptz,reason text,priority text,template_key text,context jsonb,target_route text,last_contacted_at timestamptz,snoozed_until timestamptz)
language sql set search_path='public','pg_temp' as $$
  with attention as (select * from public.communication_attention_v1 union all select * from public.aftercare_communication_attention_v1)
  select a.item_key,a.category,a.source_type,a.source_id,a.patient_id,a.contact_id,a.display_name,a.phone,a.due_at,a.event_at,a.reason,a.priority,a.template_key,a.context,a.target_route,a.last_contacted_at,a.snoozed_until
  from attention a
  where (p_category is null or p_category='' or a.category=p_category)
    and (p_search is null or btrim(p_search)='' or a.display_name ilike '%'||btrim(p_search)||'%' or (regexp_replace(btrim(p_search),'\D','','g')<>'' and regexp_replace(coalesce(a.phone,''),'\D','','g') like '%'||regexp_replace(btrim(p_search),'\D','','g')||'%'))
    and (p_include_snoozed or not a.is_snoozed) and not a.is_suppressed_after_contact
  order by case a.priority when 'overdue' then 0 when 'today' then 1 when 'tomorrow' then 2 else 3 end,a.due_at asc nulls last,a.display_name
  limit greatest(1,least(coalesce(p_limit,100),100)) offset greatest(0,least(coalesce(p_offset,0),10000));
$$;

create or replace function public.get_communication_attention_counts_v1()
returns jsonb language sql set search_path='public','pg_temp' as $$
  with attention as (select * from public.communication_attention_v1 union all select * from public.aftercare_communication_attention_v1)
  select jsonb_build_object('total',count(*),'confirmation',count(*) filter(where category='confirmation'),'crm',count(*) filter(where category='crm'),'return',count(*) filter(where category='return'),'proposal',count(*) filter(where category='proposal'),'package',count(*) filter(where category='package'),'aftercare',count(*) filter(where category='aftercare'),'overdue',count(*) filter(where priority='overdue'),'today',count(*) filter(where priority='today'))
  from attention where not is_snoozed and not is_suppressed_after_contact;
$$;

revoke all on function public.list_communication_attention_v1(text,text,boolean,integer,integer),public.get_communication_attention_counts_v1() from public,anon;
grant execute on function public.list_communication_attention_v1(text,text,boolean,integer,integer),public.get_communication_attention_counts_v1() to authenticated;
