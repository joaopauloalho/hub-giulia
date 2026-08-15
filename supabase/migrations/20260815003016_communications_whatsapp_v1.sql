-- Hub Giulia 3.4 — Comunicação & WhatsApp 2.0
-- Manual-first operational communication center. No provider, webhook or automatic send.

create table public.communication_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  confirmation_lead_hours integer not null default 36 check (confirmation_lead_hours between 1 and 168),
  proposal_followup_days integer not null default 2 check (proposal_followup_days between 0 and 30),
  package_expiry_days integer not null default 15 check (package_expiry_days between 1 and 90),
  updated_at timestamptz not null default now()
);

create table public.communication_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  template_key text not null check (template_key in ('appointment_confirmation','crm_followup','proposal_followup','procedure_return','package_expiry')),
  body text not null check (length(body) between 1 and 2000),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (user_id, template_key)
);

create table public.communication_attention_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_key text not null check (length(item_key) between 3 and 180),
  snoozed_until timestamptz,
  last_contacted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, item_key)
);

create table public.communication_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid,
  contact_id uuid,
  channel text not null default 'whatsapp' check (channel = 'whatsapp'),
  direction text not null default 'outbound' check (direction = 'outbound'),
  context text not null check (context in ('appointment_confirmation','crm_followup','procedure_return','proposal_followup','package_expiry')),
  source_type text not null check (source_type in ('appointment','crm_followup','procedure_return','proposal_version','package')),
  source_id uuid not null,
  item_key text not null check (length(item_key) between 3 and 180),
  template_key text check (template_key is null or template_key in ('appointment_confirmation','crm_followup','proposal_followup','procedure_return','package_expiry')),
  recipient_phone_snapshot text not null check (recipient_phone_snapshot ~ '^[0-9]{8,15}$'),
  message_body_snapshot text not null check (length(message_body_snapshot) between 1 and 4000),
  status text not null default 'sent_manual' check (status = 'sent_manual'),
  sent_at timestamptz not null default now(),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  constraint communication_messages_context_source_check check (
    (context = 'appointment_confirmation' and source_type = 'appointment') or
    (context = 'crm_followup' and source_type = 'crm_followup') or
    (context = 'procedure_return' and source_type = 'procedure_return') or
    (context = 'proposal_followup' and source_type = 'proposal_version') or
    (context = 'package_expiry' and source_type = 'package')
  ),
  constraint communication_messages_patient_owner_fkey foreign key (patient_id, user_id) references public.patients(id, user_id),
  constraint communication_messages_contact_owner_fkey foreign key (contact_id, user_id) references public.contacts(id, user_id),
  unique (user_id, idempotency_key)
);

create index communication_messages_user_sent_idx on public.communication_messages(user_id, sent_at desc);
create index communication_messages_patient_user_sent_idx on public.communication_messages(patient_id, user_id, sent_at desc) where patient_id is not null;
create index communication_messages_contact_user_sent_idx on public.communication_messages(contact_id, user_id, sent_at desc) where contact_id is not null;
create index communication_messages_source_idx on public.communication_messages(user_id, source_type, source_id, sent_at desc);

alter table public.communication_preferences enable row level security;
alter table public.communication_templates enable row level security;
alter table public.communication_attention_state enable row level security;
alter table public.communication_messages enable row level security;

create policy communication_preferences_own on public.communication_preferences for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy communication_templates_own on public.communication_templates for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy communication_attention_state_own on public.communication_attention_state for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy communication_messages_read_own on public.communication_messages for select to authenticated
using (user_id = (select auth.uid()));

revoke all on public.communication_preferences from anon;
revoke all on public.communication_templates from anon;
revoke all on public.communication_attention_state from anon;
revoke all on public.communication_messages from anon;
revoke all on public.communication_preferences from authenticated;
revoke all on public.communication_templates from authenticated;
revoke all on public.communication_attention_state from authenticated;
revoke all on public.communication_messages from authenticated;
grant select, insert, update, delete on public.communication_preferences to authenticated;
grant select, insert, update, delete on public.communication_templates to authenticated;
grant select, insert, update, delete on public.communication_attention_state to authenticated;
grant select on public.communication_messages to authenticated;

create or replace function public.communication_touch_updated_at_v1()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin new.updated_at := now(); return new; end;
$$;
create trigger communication_preferences_touch before update on public.communication_preferences for each row execute function public.communication_touch_updated_at_v1();
create trigger communication_templates_touch before update on public.communication_templates for each row execute function public.communication_touch_updated_at_v1();
create trigger communication_attention_state_touch before update on public.communication_attention_state for each row execute function public.communication_touch_updated_at_v1();

create or replace function public.communication_validate_template_v1()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_match text[]; v_token text;
begin
  for v_match in select regexp_matches(new.body, '\{[A-Za-z_][A-Za-z0-9_]*\}', 'g') loop
    v_token := trim(both '{}' from v_match[1]);
    if v_token not in ('first_name','name','date','time','clinic_name','proposal_title','valid_until','package_title','remaining_credits') then
      raise exception 'COMMUNICATION_TEMPLATE_PLACEHOLDER_INVALID:%', v_token;
    end if;
  end loop;
  return new;
end;
$$;
create trigger communication_templates_validate before insert or update of body on public.communication_templates for each row execute function public.communication_validate_template_v1();

create or replace function public.communication_whatsapp_digits_v1(p_phone text)
returns text language plpgsql immutable set search_path = public, pg_temp as $$
declare v_raw text; v_digits text;
begin
  v_raw := btrim(coalesce(p_phone, ''));
  if v_raw = '' then return null; end if;
  v_digits := regexp_replace(v_raw, '\D', '', 'g');
  if left(v_raw, 1) = '+' then
    if length(v_digits) between 8 and 15 then return v_digits; end if;
    return null;
  end if;
  if left(v_digits, 2) = '55' and length(v_digits) in (12, 13) then return v_digits; end if;
  if length(v_digits) in (10, 11) then return '55' || v_digits; end if;
  return null;
end;
$$;
revoke all on function public.communication_touch_updated_at_v1() from public, anon, authenticated;
revoke all on function public.communication_validate_template_v1() from public, anon, authenticated;
revoke all on function public.communication_whatsapp_digits_v1(text) from public, anon, authenticated;

create or replace view public.communication_attention_v1 with (security_invoker = true) as
with params as (
  select (select auth.uid()) as user_id,
         (now() at time zone 'America/Sao_Paulo')::date as today,
         coalesce((select cp.confirmation_lead_hours from public.communication_preferences cp where cp.user_id=(select auth.uid())),36) as confirmation_lead_hours,
         coalesce((select cp.proposal_followup_days from public.communication_preferences cp where cp.user_id=(select auth.uid())),2) as proposal_followup_days,
         coalesce((select cp.package_expiry_days from public.communication_preferences cp where cp.user_id=(select auth.uid())),15) as package_expiry_days
), appointment_attention as (
  select 'appointment:'||a.id::text||':confirmation' item_key, 'confirmation'::text category, 'appointment'::text source_type, a.id source_id,
         a.patient_id, null::uuid contact_id, coalesce(p.name,'Paciente') display_name, p.phone,
         a.scheduled_at due_at, a.scheduled_at event_at, 'Horário aguardando confirmação'::text reason,
         case when (a.scheduled_at at time zone 'America/Sao_Paulo')::date=x.today then 'today'
              when (a.scheduled_at at time zone 'America/Sao_Paulo')::date=x.today+1 then 'tomorrow' else 'upcoming' end::text priority,
         'appointment_confirmation'::text template_key, jsonb_build_object('scheduled_at',a.scheduled_at) context, '/agenda'::text target_route
  from public.appointments a join params x on true join public.patients p on p.id=a.patient_id and p.user_id=x.user_id
  where a.user_id=x.user_id and a.status='pendente'
    and a.scheduled_at >= (x.today::timestamp at time zone 'America/Sao_Paulo')
    and a.scheduled_at <= now()+make_interval(hours=>x.confirmation_lead_hours)
), crm_attention as (
  select 'crm_followup:'||f.id::text, 'crm'::text, 'crm_followup'::text, f.id, c.patient_id, c.id,
         coalesce(c.name,'Contato'), c.phone,
         ((f.due_on::timestamp+time '09:00') at time zone 'America/Sao_Paulo'), ((f.due_on::timestamp+time '09:00') at time zone 'America/Sao_Paulo'),
         case when f.due_on<x.today then 'Follow-up CRM atrasado' else 'Follow-up CRM para hoje' end::text,
         case when f.due_on<x.today then 'overdue' else 'today' end::text,
         'crm_followup'::text, jsonb_build_object('deal_id',d.id,'deal_title',d.title,'due_on',f.due_on), '/crm'::text
  from public.crm_followups f join params x on true join public.deals d on d.id=f.deal_id and d.user_id=x.user_id join public.contacts c on c.id=d.contact_id and c.user_id=x.user_id
  where f.user_id=x.user_id and f.status='open' and f.due_on<=x.today
), return_attention as (
  select 'return:'||r.id::text, 'return'::text, 'procedure_return'::text, r.id, r.patient_id, null::uuid,
         coalesce(r.patient_name,'Paciente'), r.patient_phone,
         ((r.window_start::timestamp+time '09:00') at time zone 'America/Sao_Paulo'), ((r.window_start::timestamp+time '09:00') at time zone 'America/Sao_Paulo'),
         case when r.window_end<x.today then 'Retorno atrasado' when r.window_start<=x.today then 'Retorno disponível' else 'Retorno próximo' end::text,
         case when r.window_end<x.today then 'overdue' when r.window_start<=x.today then 'today' when r.window_start=x.today+1 then 'tomorrow' else 'upcoming' end::text,
         'procedure_return'::text, jsonb_build_object('window_start',r.window_start,'window_end',r.window_end,'return_type',r.return_type), '/retornos'::text
  from public.list_procedure_returns_v2() r join params x on true
  where r.completed_at is null and r.dismissed_at is null and r.contacted_at is null and r.appointment_id is null and r.window_start<=x.today+5
), proposal_attention as (
  select 'proposal:'||v.id::text||':followup', 'proposal'::text, 'proposal_version'::text, v.id, c.patient_id, c.id,
         coalesce(c.name,'Contato'), c.phone, v.sent_at+make_interval(days=>x.proposal_followup_days), v.sent_at,
         'Proposta aguardando follow-up'::text,
         case when v.sent_at+make_interval(days=>x.proposal_followup_days)<(x.today::timestamp at time zone 'America/Sao_Paulo') then 'overdue'
              when v.sent_at+make_interval(days=>x.proposal_followup_days)<((x.today+1)::timestamp at time zone 'America/Sao_Paulo') then 'today'
              when v.sent_at+make_interval(days=>x.proposal_followup_days)<((x.today+2)::timestamp at time zone 'America/Sao_Paulo') then 'tomorrow' else 'upcoming' end::text,
         'proposal_followup'::text,
         jsonb_build_object('proposal_id',tp.id,'deal_id',d.id,'proposal_title',v.title,'total_value',v.total_value,'sent_at',v.sent_at,'valid_until',v.valid_until),
         '/crm/deals/'||d.id::text||'/proposals/'||tp.id::text
  from public.treatment_proposal_versions v join params x on true join public.treatment_proposals tp on tp.id=v.proposal_id and tp.user_id=x.user_id
  join public.deals d on d.id=tp.deal_id and d.user_id=x.user_id join public.contacts c on c.id=d.contact_id and c.user_id=x.user_id
  where v.user_id=x.user_id and v.status='issued' and v.sent_at is not null and (v.valid_until is null or v.valid_until>=x.today)
    and v.sent_at+make_interval(days=>x.proposal_followup_days)<=now()
), package_rollup as (
  select b.user_id,b.patient_id,b.package_id,max(b.package_title) package_title,max(b.valid_until) valid_until,sum(b.available_balance) remaining_credits
  from public.patient_credit_item_balances_v b join params x on true
  where b.user_id=x.user_id and b.package_status='active' and b.valid_until is not null and b.valid_until>=x.today
    and b.valid_until<=x.today+x.package_expiry_days and b.available_balance>0
  group by b.user_id,b.patient_id,b.package_id having sum(b.available_balance)>0
), package_attention as (
  select 'package:'||pr.package_id::text||':expiry', 'package'::text, 'package'::text, pr.package_id, pr.patient_id, null::uuid,
         coalesce(p.name,'Paciente'),p.phone,((pr.valid_until::timestamp+time '09:00') at time zone 'America/Sao_Paulo'),
         ((pr.valid_until::timestamp+time '09:00') at time zone 'America/Sao_Paulo'),'Crédito disponível com validade próxima'::text,
         case when pr.valid_until=x.today then 'today' when pr.valid_until=x.today+1 then 'tomorrow' else 'upcoming' end::text,
         'package_expiry'::text,jsonb_build_object('package_title',pr.package_title,'valid_until',pr.valid_until,'remaining_credits',pr.remaining_credits),'/pacotes'::text
  from package_rollup pr join params x on true join public.patients p on p.id=pr.patient_id and p.user_id=x.user_id
), all_attention as (
  select * from appointment_attention union all select * from crm_attention union all select * from return_attention union all select * from proposal_attention union all select * from package_attention
)
select a.item_key,a.category,a.source_type,a.source_id,a.patient_id,a.contact_id,a.display_name,a.phone,a.due_at,a.event_at,a.reason,a.priority,a.template_key,a.context,a.target_route,
       s.last_contacted_at,s.snoozed_until,coalesce(s.snoozed_until>now(),false) is_snoozed,
       (a.category in ('proposal','package') and s.last_contacted_at is not null and s.snoozed_until is null) is_suppressed_after_contact
from all_attention a left join public.communication_attention_state s on s.user_id=(select auth.uid()) and s.item_key=a.item_key;
revoke all on public.communication_attention_v1 from anon;
grant select on public.communication_attention_v1 to authenticated;

create or replace function public.list_communication_attention_v1(p_category text default null,p_search text default null,p_include_snoozed boolean default false,p_limit integer default 100,p_offset integer default 0)
returns table(item_key text,category text,source_type text,source_id uuid,patient_id uuid,contact_id uuid,display_name text,phone text,due_at timestamptz,event_at timestamptz,reason text,priority text,template_key text,context jsonb,target_route text,last_contacted_at timestamptz,snoozed_until timestamptz)
language sql security invoker set search_path=public,pg_temp as $$
  select a.item_key,a.category,a.source_type,a.source_id,a.patient_id,a.contact_id,a.display_name,a.phone,a.due_at,a.event_at,a.reason,a.priority,a.template_key,a.context,a.target_route,a.last_contacted_at,a.snoozed_until
  from public.communication_attention_v1 a
  where (p_category is null or p_category='' or a.category=p_category)
    and (p_search is null or btrim(p_search)='' or a.display_name ilike '%'||btrim(p_search)||'%' or regexp_replace(coalesce(a.phone,''),'\D','','g') like '%'||regexp_replace(btrim(p_search),'\D','','g')||'%')
    and (p_include_snoozed or not a.is_snoozed) and not a.is_suppressed_after_contact
  order by case a.priority when 'overdue' then 0 when 'today' then 1 when 'tomorrow' then 2 else 3 end,a.due_at asc nulls last,a.display_name
  limit greatest(1,least(coalesce(p_limit,100),100)) offset greatest(0,least(coalesce(p_offset,0),10000));
$$;

create or replace function public.get_communication_attention_counts_v1()
returns jsonb language sql security invoker set search_path=public,pg_temp as $$
  select jsonb_build_object('total',count(*),'confirmation',count(*) filter(where category='confirmation'),'crm',count(*) filter(where category='crm'),'return',count(*) filter(where category='return'),'proposal',count(*) filter(where category='proposal'),'package',count(*) filter(where category='package'),'overdue',count(*) filter(where priority='overdue'),'today',count(*) filter(where priority='today'))
  from public.communication_attention_v1 where not is_snoozed and not is_suppressed_after_contact;
$$;

create or replace function public.list_patient_communications_v1(p_patient_id uuid,p_limit integer default 10,p_offset integer default 0)
returns table(id uuid,channel text,context text,status text,sent_at timestamptz,message_body_snapshot text,item_key text)
language sql security invoker set search_path=public,pg_temp as $$
  select m.id,m.channel,m.context,m.status,m.sent_at,m.message_body_snapshot,m.item_key from public.communication_messages m
  where m.user_id=(select auth.uid()) and m.patient_id=p_patient_id order by m.sent_at desc
  limit greatest(1,least(coalesce(p_limit,10),50)) offset greatest(0,least(coalesce(p_offset,0),10000));
$$;

create or replace function public.record_manual_communication_v1(p_source_type text,p_source_id uuid,p_item_key text,p_context text,p_recipient_phone text,p_message_body text,p_template_key text,p_idempotency_key uuid)
returns table(message_id uuid,patient_id uuid,contact_id uuid,sent_at timestamptz,was_created boolean)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_user uuid:=auth.uid(); v_patient_id uuid; v_contact_id uuid; v_deal_id uuid; v_phone text;
  v_expected_phone text; v_received_phone text; v_expected_item_key text; v_message_id uuid; v_sent_at timestamptz; v_created boolean:=false;
begin
  if v_user is null then raise exception 'COMMUNICATION_SESSION_REQUIRED'; end if;
  if p_source_id is null or p_idempotency_key is null then raise exception 'COMMUNICATION_INVALID_INPUT'; end if;
  if nullif(btrim(p_message_body),'') is null or length(p_message_body)>4000 then raise exception 'COMMUNICATION_MESSAGE_INVALID'; end if;
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
  else raise exception 'COMMUNICATION_SOURCE_CONTEXT_INVALID';
  end if;
  if not found then raise exception 'COMMUNICATION_SOURCE_NOT_FOUND'; end if;
  if p_item_key is distinct from v_expected_item_key then raise exception 'COMMUNICATION_ITEM_KEY_INVALID'; end if;
  v_expected_phone:=public.communication_whatsapp_digits_v1(v_phone); v_received_phone:=public.communication_whatsapp_digits_v1(p_recipient_phone);
  if v_expected_phone is null or v_received_phone is null or v_expected_phone<>v_received_phone then raise exception 'COMMUNICATION_PHONE_INVALID'; end if;
  insert into public.communication_messages(user_id,patient_id,contact_id,channel,direction,context,source_type,source_id,item_key,template_key,recipient_phone_snapshot,message_body_snapshot,status,sent_at,idempotency_key)
  values(v_user,v_patient_id,v_contact_id,'whatsapp','outbound',p_context,p_source_type,p_source_id,p_item_key,p_template_key,v_expected_phone,p_message_body,'sent_manual',now(),p_idempotency_key)
  on conflict(user_id,idempotency_key) do nothing returning id,communication_messages.sent_at into v_message_id,v_sent_at;
  if v_message_id is not null then
    v_created:=true;
    insert into public.communication_attention_state(user_id,item_key,last_contacted_at,snoozed_until) values(v_user,p_item_key,v_sent_at,null)
    on conflict(user_id,item_key) do update set last_contacted_at=excluded.last_contacted_at,snoozed_until=null,updated_at=now();
    if v_contact_id is not null and v_deal_id is not null and p_source_type in ('crm_followup','proposal_version') then
      insert into public.crm_activities(user_id,contact_id,deal_id,activity_type,channel,note,metadata,actor_user_id)
      values(v_user,v_contact_id,v_deal_id,'contact','whatsapp','WhatsApp registrado manualmente pela Central de Comunicação.',jsonb_build_object('communication_message_id',v_message_id,'context',p_context,'source_type',p_source_type,'source_id',p_source_id),v_user);
    end if;
  else
    select m.id,m.sent_at,m.patient_id,m.contact_id into v_message_id,v_sent_at,v_patient_id,v_contact_id from public.communication_messages m where m.user_id=v_user and m.idempotency_key=p_idempotency_key;
  end if;
  return query select v_message_id,v_patient_id,v_contact_id,v_sent_at,v_created;
end;
$$;

revoke all on function public.list_communication_attention_v1(text,text,boolean,integer,integer) from public,anon;
revoke all on function public.get_communication_attention_counts_v1() from public,anon;
revoke all on function public.list_patient_communications_v1(uuid,integer,integer) from public,anon;
revoke all on function public.record_manual_communication_v1(text,uuid,text,text,text,text,text,uuid) from public,anon;
grant execute on function public.list_communication_attention_v1(text,text,boolean,integer,integer) to authenticated;
grant execute on function public.get_communication_attention_counts_v1() to authenticated;
grant execute on function public.list_patient_communications_v1(uuid,integer,integer) to authenticated;
grant execute on function public.record_manual_communication_v1(text,uuid,text,text,text,text,text,uuid) to authenticated;
