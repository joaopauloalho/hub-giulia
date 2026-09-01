begin;

-- ---------------------------------------------------------------------------
-- Propostas: orçamento simples, condição por item e exclusão definitiva segura
-- ---------------------------------------------------------------------------

alter table public.treatment_proposal_items
  add column if not exists payment_condition text;

create or replace function public.save_treatment_proposal_draft_v2(
  p_version_id uuid,
  p_expected_revision bigint,
  p_title text,
  p_valid_until date,
  p_payment_terms text,
  p_internal_note text,
  p_customer_note text,
  p_discount_type text,
  p_discount_value numeric,
  p_items jsonb
) returns table(version_id uuid, draft_revision bigint, subtotal numeric, item_discount_amount numeric, net_subtotal numeric, discount_amount numeric, total_value numeric, updated_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_version public.treatment_proposal_versions%rowtype;
  v_item jsonb;
  v_ord bigint;
  v_service uuid;
  v_name text;
  v_qty numeric;
  v_list numeric;
  v_offered numeric;
  v_dtype text;
  v_dvalue numeric;
  v_unit text;
begin
  if v_uid is null then raise exception 'PROPOSAL_SESSION_REQUIRED'; end if;
  select * into v_version from public.treatment_proposal_versions
  where id = p_version_id and user_id = v_uid for update;
  if not found then raise exception 'PROPOSAL_VERSION_NOT_FOUND'; end if;
  if v_version.status <> 'draft' then raise exception 'PROPOSAL_VERSION_IMMUTABLE'; end if;
  if v_version.draft_revision <> coalesce(p_expected_revision,-1) then raise exception 'PROPOSAL_DRAFT_CONFLICT'; end if;
  if nullif(btrim(p_title),'') is null then raise exception 'PROPOSAL_TITLE_REQUIRED'; end if;
  if p_discount_type not in ('none','amount','percent') then raise exception 'PROPOSAL_INVALID_DISCOUNT_TYPE'; end if;
  if p_discount_type = 'none' and coalesce(p_discount_value,0) <> 0 then raise exception 'PROPOSAL_NONE_DISCOUNT_VALUE'; end if;
  if coalesce(p_discount_value,0) < 0 or (p_discount_type='percent' and coalesce(p_discount_value,0)>100) then raise exception 'PROPOSAL_INVALID_DISCOUNT'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'PROPOSAL_ITEMS_INVALID'; end if;

  update public.treatment_proposal_versions
  set title=btrim(p_title), valid_until=p_valid_until, payment_terms=nullif(btrim(p_payment_terms),''),
      internal_note=nullif(btrim(p_internal_note),''), customer_note=nullif(btrim(p_customer_note),''),
      discount_type=p_discount_type, discount_value=coalesce(p_discount_value,0), updated_at=now()
  where id=p_version_id;

  perform set_config('app.proposal_skip_recalc','on',true);
  delete from public.treatment_proposal_items where proposal_version_id=p_version_id and user_id=v_uid;

  for v_item, v_ord in select value, ordinality from jsonb_array_elements(p_items) with ordinality loop
    v_service := nullif(v_item->>'service_id','')::uuid;
    if v_service is not null and not exists(select 1 from public.services s where s.id=v_service and s.user_id=v_uid) then
      raise exception 'PROPOSAL_SERVICE_NOT_FOUND';
    end if;
    v_name := nullif(btrim(v_item->>'service_name_snapshot'),'');
    if v_name is null then raise exception 'PROPOSAL_ITEM_NAME_REQUIRED'; end if;
    v_qty := coalesce(nullif(v_item->>'quantity','')::numeric,1);
    v_list := coalesce(nullif(v_item->>'list_unit_price_snapshot','')::numeric,0);
    v_offered := coalesce(nullif(v_item->>'offered_unit_price','')::numeric,0);
    v_dtype := coalesce(nullif(v_item->>'discount_type',''),'none');
    v_dvalue := coalesce(nullif(v_item->>'discount_value','')::numeric,0);
    v_unit := coalesce(nullif(btrim(v_item->>'unit_label'),''),'procedimento');
    insert into public.treatment_proposal_items(
      user_id, proposal_version_id, service_id, service_name_snapshot, description_snapshot, interval_note, payment_condition,
      quantity, unit_label, list_unit_price_snapshot, offered_unit_price, discount_type, discount_value, sort_order
    ) values(
      v_uid,p_version_id,v_service,v_name,nullif(btrim(v_item->>'description_snapshot'),''),nullif(btrim(v_item->>'interval_note'),''),nullif(btrim(v_item->>'payment_condition'),''),
      v_qty,v_unit,v_list,v_offered,v_dtype,v_dvalue,coalesce(nullif(v_item->>'sort_order','')::integer,v_ord::integer-1)
    );
  end loop;
  perform set_config('app.proposal_skip_recalc','off',true);
  perform public.proposal_recalculate_version_v1(p_version_id);

  update public.treatment_proposal_versions
  set draft_revision=draft_revision+1, updated_at=now()
  where id=p_version_id
  returning * into v_version;

  return query select v_version.id,v_version.draft_revision,v_version.subtotal,v_version.item_discount_amount,v_version.net_subtotal,v_version.discount_amount,v_version.total_value,v_version.updated_at;
end;
$$;

create or replace function public.advance_crm_for_treatment_proposal_v1(p_proposal_id uuid)
returns table(deal_id uuid, previous_stage text, current_stage text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_deal public.deals%rowtype;
  v_from text;
  v_contact uuid;
begin
  if v_uid is null then raise exception 'PROPOSAL_SESSION_REQUIRED'; end if;

  select d.* into v_deal
  from public.treatment_proposals p
  join public.deals d on d.id=p.deal_id and d.user_id=p.user_id
  where p.id=p_proposal_id and p.user_id=v_uid
  for update of d;
  if not found then raise exception 'PROPOSAL_NOT_FOUND'; end if;

  v_from := v_deal.stage;
  v_contact := v_deal.contact_id;
  if v_deal.stage in ('new','contacted','assessment_scheduled') then
    update public.deals
      set stage='proposal_sent', updated_at=now()
      where id=v_deal.id and user_id=v_uid
      returning * into v_deal;
    insert into public.crm_activities(user_id,contact_id,deal_id,activity_type,note,from_stage,to_stage,metadata,actor_user_id)
    values(v_uid,v_contact,v_deal.id,'stage_changed','Proposta enviada: estágio atualizado pela ficha da paciente',v_from,v_deal.stage,
           jsonb_build_object('proposal_id',p_proposal_id,'automatic',true),v_uid);
  end if;

  return query select v_deal.id,v_from,v_deal.stage;
end;
$$;

create or replace function public.delete_treatment_proposal_v2(p_proposal_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_version_ids uuid[];
  v_pdf_paths text[];
begin
  if v_uid is null then raise exception 'PROPOSAL_SESSION_REQUIRED'; end if;
  perform 1 from public.treatment_proposals p where p.id=p_proposal_id and p.user_id=v_uid for update;
  if not found then raise exception 'PROPOSAL_NOT_FOUND'; end if;

  select coalesce(array_agg(v.id),'{}'::uuid[]), coalesce(array_agg(v.pdf_path) filter(where v.pdf_path is not null),'{}'::text[])
  into v_version_ids,v_pdf_paths
  from public.treatment_proposal_versions v
  where v.proposal_id=p_proposal_id and v.user_id=v_uid;

  if exists(
    select 1 from public.patient_packages pp
    where pp.user_id=v_uid and pp.source_proposal_version_id=any(v_version_ids)
  ) then
    raise exception 'PROPOSAL_DELETE_LINKED';
  end if;

  delete from public.crm_activities a
  where a.user_id=v_uid and a.metadata->>'proposal_id'=p_proposal_id::text;

  delete from public.communication_messages m
  where m.user_id=v_uid and m.source_type='proposal_version' and m.source_id=any(v_version_ids);

  if cardinality(v_pdf_paths)>0 then
    delete from storage.objects o where o.bucket_id='proposals' and o.name=any(v_pdf_paths);
  end if;

  delete from public.treatment_proposals p where p.id=p_proposal_id and p.user_id=v_uid;
  return found;
end;
$$;

revoke all on function public.save_treatment_proposal_draft_v2(uuid,bigint,text,date,text,text,text,text,numeric,jsonb) from public;
revoke all on function public.advance_crm_for_treatment_proposal_v1(uuid) from public;
revoke all on function public.delete_treatment_proposal_v2(uuid) from public;
grant execute on function public.save_treatment_proposal_draft_v2(uuid,bigint,text,date,text,text,text,text,numeric,jsonb) to authenticated, service_role;
grant execute on function public.advance_crm_for_treatment_proposal_v1(uuid) to authenticated, service_role;
grant execute on function public.delete_treatment_proposal_v2(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- CRM: paciente cadastrada começa em Em contato; recorrência é derivada
-- ---------------------------------------------------------------------------

update public.deals
set stage='contacted', updated_at=now()
where stage='new' and closed_at is null;

create or replace function public.create_crm_deal_v1(
  p_contact_id uuid,
  p_title text,
  p_value numeric default null,
  p_expected_close date default null,
  p_interests jsonb default '[]'::jsonb,
  p_note text default null,
  p_idempotency_key uuid default gen_random_uuid()
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare v_user_id uuid := auth.uid(); v_deal_id uuid; v_interest jsonb; v_service_id uuid; v_service_name text; v_label text;
begin
 if v_user_id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if; if p_idempotency_key is null then raise exception 'CRM_IDEMPOTENCY_REQUIRED' using errcode='23514'; end if;
 perform 1 from public.contacts c where c.id=p_contact_id and c.user_id=v_user_id for update; if not found then raise exception 'CRM_CONTACT_NOT_FOUND' using errcode='P0002'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_idempotency_key::text,0)); select d.id into v_deal_id from public.deals d where d.user_id=v_user_id and d.idempotency_key=p_idempotency_key; if v_deal_id is not null then return jsonb_build_object('contact_id',p_contact_id,'deal_id',v_deal_id,'reused',true); end if;
 insert into public.deals(user_id,contact_id,title,value,stage,expected_close,idempotency_key) values(v_user_id,p_contact_id,coalesce(nullif(btrim(p_title),''),'Nova oportunidade'),p_value,'contacted',p_expected_close,p_idempotency_key) returning id into v_deal_id;
 if jsonb_typeof(coalesce(p_interests,'[]'::jsonb)) <> 'array' then raise exception 'CRM_INTERESTS_INVALID' using errcode='22023'; end if;
 for v_interest in select value from jsonb_array_elements(coalesce(p_interests,'[]'::jsonb)) loop v_service_id:=nullif(v_interest->>'service_id','')::uuid; v_label:=nullif(btrim(v_interest->>'label'),''); v_service_name:=null; if v_service_id is not null then select s.name into v_service_name from public.services s where s.id=v_service_id and s.user_id=v_user_id; if v_service_name is null then raise exception 'CRM_SERVICE_NOT_FOUND' using errcode='23503'; end if; end if; if coalesce(v_label,v_service_name) is not null then insert into public.crm_deal_interests(user_id,deal_id,service_id,label_snapshot) values(v_user_id,v_deal_id,v_service_id,coalesce(v_label,v_service_name)); end if; end loop;
 if nullif(btrim(p_note),'') is not null then insert into public.crm_activities(user_id,contact_id,deal_id,activity_type,note,actor_user_id) values(v_user_id,p_contact_id,v_deal_id,'note',btrim(p_note),v_user_id); end if; return jsonb_build_object('contact_id',p_contact_id,'deal_id',v_deal_id,'reused',false);
end;
$$;

create or replace function public.create_crm_lead_v2(
  p_name text,
  p_phone text default null,
  p_email text default null,
  p_instagram text default null,
  p_source text default null,
  p_source_detail text default null,
  p_referred_by_patient_id uuid default null,
  p_referrer_name text default null,
  p_title text default null,
  p_value numeric default null,
  p_expected_close date default null,
  p_interests jsonb default '[]'::jsonb,
  p_note text default null,
  p_idempotency_key uuid default gen_random_uuid()
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid(); v_contact_id uuid; v_deal_id uuid; v_interest jsonb; v_service_id uuid; v_service_name text; v_label text;
  v_source text := nullif(btrim(p_source), ''); v_source_detail text := nullif(btrim(p_source_detail), '');
  v_referrer_id uuid := p_referred_by_patient_id; v_referrer_name text := nullif(btrim(p_referrer_name), '');
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if nullif(btrim(p_name), '') is null then raise exception 'CRM_NAME_REQUIRED' using errcode='23514'; end if;
  if p_idempotency_key is null then raise exception 'CRM_IDEMPOTENCY_REQUIRED' using errcode='23514'; end if;
  if v_source is not null and not (v_source = any(array['instagram','referral','google','partnership','existing_patient','campaign','other'])) then raise exception 'CRM_ACQUISITION_SOURCE_INVALID' using errcode='23514'; end if;
  if v_source is distinct from 'referral' then v_referrer_id := null; v_referrer_name := null; elsif v_referrer_id is not null then v_referrer_name := null; end if;
  if v_source is null or not (v_source = any(array['partnership','campaign','other'])) then v_source_detail := null; end if;
  if v_referrer_id is not null and not exists(select 1 from public.patients p where p.id=v_referrer_id and p.user_id=v_user_id) then raise exception 'CRM_REFERRER_NOT_FOUND' using errcode='23503'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_idempotency_key::text, 0));
  select d.contact_id,d.id into v_contact_id,v_deal_id from public.deals d where d.user_id=v_user_id and d.idempotency_key=p_idempotency_key;
  if v_deal_id is not null then return jsonb_build_object('contact_id',v_contact_id,'deal_id',v_deal_id,'reused',true); end if;
  insert into public.contacts(user_id,name,phone,email,instagram,source,source_detail,referred_by_patient_id,referrer_name)
  values(v_user_id,btrim(p_name),nullif(btrim(p_phone),''),nullif(lower(btrim(p_email)),''),nullif(btrim(p_instagram),''),v_source,v_source_detail,v_referrer_id,v_referrer_name)
  returning id into v_contact_id;
  insert into public.deals(user_id,contact_id,title,value,stage,expected_close,idempotency_key)
  values(v_user_id,v_contact_id,coalesce(nullif(btrim(p_title),''),'Oportunidade · '||btrim(p_name)),p_value,'contacted',p_expected_close,p_idempotency_key)
  returning id into v_deal_id;
  if jsonb_typeof(coalesce(p_interests,'[]'::jsonb)) <> 'array' then raise exception 'CRM_INTERESTS_INVALID' using errcode='22023'; end if;
  for v_interest in select value from jsonb_array_elements(coalesce(p_interests,'[]'::jsonb)) loop
    v_service_id:=nullif(v_interest->>'service_id','')::uuid; v_label:=nullif(btrim(v_interest->>'label'),''); v_service_name:=null;
    if v_service_id is not null then select s.name into v_service_name from public.services s where s.id=v_service_id and s.user_id=v_user_id; if v_service_name is null then raise exception 'CRM_SERVICE_NOT_FOUND' using errcode='23503'; end if; end if;
    if coalesce(v_label,v_service_name) is not null then insert into public.crm_deal_interests(user_id,deal_id,service_id,label_snapshot) values(v_user_id,v_deal_id,v_service_id,coalesce(v_label,v_service_name)); end if;
  end loop;
  if nullif(btrim(p_note),'') is not null then insert into public.crm_activities(user_id,contact_id,deal_id,activity_type,note,actor_user_id) values(v_user_id,v_contact_id,v_deal_id,'note',btrim(p_note),v_user_id); end if;
  return jsonb_build_object('contact_id',v_contact_id,'deal_id',v_deal_id,'reused',false);
end;
$$;

create or replace view public.crm_pipeline_v as
select d.id as deal_id,d.user_id,d.contact_id,d.title,d.value as estimated_value,d.stage,d.expected_close,d.lost_reason,d.lost_reason_detail,d.won_at,d.lost_at,d.closed_at,d.created_at as deal_created_at,d.updated_at as deal_updated_at,
       c.patient_id,c.name as contact_name,c.phone,c.email,c.instagram,c.source,c.source_detail,c.archived_at as contact_archived_at,pat.name as patient_name,
       coalesce(i.interests,'[]'::jsonb) as interests,f.next_followup_on,a.last_activity_at,
       q.proposal_id,q.version_id as proposal_version_id,q.title as proposal_title,q.version_number as proposal_version_number,q.status as proposal_status,q.effective_status as proposal_effective_status,q.total_value as proposal_total_value,q.valid_until as proposal_valid_until,q.sent_at as proposal_sent_at,
       c.referred_by_patient_id,c.referrer_name,referrer.name as referrer_patient_name,
       coalesce(h.visit_count,0)>0 as is_recurring,h.last_visit_at
from public.deals d
join public.contacts c on c.id=d.contact_id and c.user_id=d.user_id
left join public.patients pat on pat.id=c.patient_id and pat.user_id=c.user_id
left join public.patients referrer on referrer.id=c.referred_by_patient_id and referrer.user_id=c.user_id
left join lateral (select jsonb_agg(jsonb_build_object('id',x.id,'service_id',x.service_id,'label',x.label_snapshot) order by x.created_at,x.id) interests from public.crm_deal_interests x where x.user_id=d.user_id and x.deal_id=d.id) i on true
left join lateral (select min(fu.due_on) next_followup_on from public.crm_followups fu where fu.user_id=d.user_id and fu.deal_id=d.id and fu.status='open') f on true
left join lateral (select max(ac.occurred_at) last_activity_at from public.crm_activities ac where ac.user_id=d.user_id and ac.deal_id=d.id) a on true
left join lateral (select s.* from public.treatment_proposal_summary_v s where s.user_id=d.user_id and s.deal_id=d.id order by s.proposal_updated_at desc,s.proposal_id desc limit 1) q on true
left join lateral (select count(*)::integer visit_count,max(p.performed_at) last_visit_at from public.procedures p where p.user_id=d.user_id and p.patient_id=c.patient_id) h on c.patient_id is not null;

-- ---------------------------------------------------------------------------
-- Relacionamento: aniversários de hoje e dos próximos 7 dias
-- ---------------------------------------------------------------------------

alter table public.communication_templates drop constraint if exists communication_templates_template_key_check;
alter table public.communication_templates add constraint communication_templates_template_key_check check(template_key = any(array[
  'appointment_confirmation','crm_followup','proposal_followup','procedure_return','package_expiry','aftercare_instructions','post_procedure_checkin','relationship_reactivation','waitlist_slot','appointment_recovery','birthday_greeting'
]));
alter table public.communication_messages drop constraint if exists communication_messages_context_check;
alter table public.communication_messages add constraint communication_messages_context_check check(context = any(array[
  'appointment_confirmation','crm_followup','procedure_return','proposal_followup','package_expiry','aftercare_instructions','post_procedure_checkin','relationship_reactivation','waitlist_slot','appointment_recovery','birthday_greeting'
]));
alter table public.communication_messages drop constraint if exists communication_messages_template_key_check;
alter table public.communication_messages add constraint communication_messages_template_key_check check(template_key is null or template_key = any(array[
  'appointment_confirmation','crm_followup','proposal_followup','procedure_return','package_expiry','aftercare_instructions','post_procedure_checkin','relationship_reactivation','waitlist_slot','appointment_recovery','birthday_greeting'
]));
alter table public.communication_messages drop constraint if exists communication_messages_context_source_check;
alter table public.communication_messages add constraint communication_messages_context_source_check check(
  ((context='appointment_confirmation' and source_type='appointment') or
   (context='crm_followup' and source_type='crm_followup') or
   (context='procedure_return' and source_type='procedure_return') or
   (context='proposal_followup' and source_type='proposal_version') or
   (context='package_expiry' and source_type='package') or
   (context='aftercare_instructions' and source_type='procedure_followup_plan') or
   (context='post_procedure_checkin' and source_type='procedure_followup_task') or
   (context='relationship_reactivation' and source_type='relationship_patient') or
   (context='waitlist_slot' and source_type='relationship_patient') or
   (context='appointment_recovery' and source_type='appointment') or
   (context='birthday_greeting' and source_type='relationship_patient'))
);

create or replace function public.birthday_date_for_year_v1(p_birth_date date,p_year integer)
returns date
language sql
immutable
strict
set search_path=public,pg_temp
as $$
  select make_date(p_year,extract(month from p_birth_date)::integer,
    least(extract(day from p_birth_date)::integer,
      extract(day from (make_date(p_year,extract(month from p_birth_date)::integer,1)+interval '1 month - 1 day'))::integer));
$$;

create or replace view public.birthday_relationship_opportunity_sources_v1 as
with base as (
  select p.*, (now() at time zone 'America/Sao_Paulo')::date as today
  from public.patients p
  where p.archived_at is null and p.birth_date is not null
), dated as (
  select b.*, public.birthday_date_for_year_v1(b.birth_date,extract(year from b.today)::integer) as this_year
  from base b
), due as (
  select d.*,case when d.this_year>=d.today then d.this_year else public.birthday_date_for_year_v1(d.birth_date,extract(year from d.today)::integer+1) end as birthday_on
  from dated d
)
select
  d.user_id,
  'patient'::text person_type,
  d.id person_id,
  d.id patient_id,
  c.id contact_id,
  d.name display_name,
  d.phone,
  v.last_visit_at,
  ap.next_appointment_at,
  st.last_contacted_at last_contact_at,
  st.snoozed_until,
  'birthday:'||d.id::text||':'||extract(year from d.birthday_on)::integer::text opportunity_key,
  'birthday'::text opportunity_type,
  case when d.birthday_on=d.today then 'birthday_today' else 'birthday_upcoming' end::text priority_class,
  case when d.birthday_on=d.today then 55 else 25 end::integer priority_rank,
  (d.birthday_on::timestamp at time zone 'America/Sao_Paulo') sort_at,
  case when d.birthday_on=d.today then 'Aniversário hoje' else 'Aniversário em '||to_char(d.birthday_on,'DD/MM') end::text label,
  'relationship_patient'::text source_type,
  d.id source_id,
  'upcoming'::text status,
  d.birthday_on due_date,
  (d.birthday_on-d.today)::integer age_days,
  null::numeric amount,
  null::jsonb remaining,
  d.birthday_on expires_on,
  '/pacientes/'||d.id::text route,
  'birthday:'||d.id::text||':'||extract(year from d.birthday_on)::integer::text communication_item_key,
  'birthday_greeting'::text template_key,
  jsonb_build_object('birth_date',d.birth_date,'birthday_on',d.birthday_on) context
from due d
left join lateral (select c0.id from public.contacts c0 where c0.user_id=d.user_id and c0.patient_id=d.id and c0.archived_at is null order by c0.created_at desc limit 1) c on true
left join lateral (select max(p0.performed_at) last_visit_at from public.procedures p0 where p0.user_id=d.user_id and p0.patient_id=d.id) v on true
left join lateral (select min(a0.scheduled_at) next_appointment_at from public.appointments a0 where a0.user_id=d.user_id and a0.patient_id=d.id and a0.scheduled_at>=now() and a0.status in ('agendado','confirmado')) ap on true
left join public.communication_attention_state st on st.user_id=d.user_id and st.item_key='relationship:patient:'||d.id::text
where d.birthday_on between d.today and d.today+7;

revoke all on public.birthday_relationship_opportunity_sources_v1 from public, anon, authenticated;

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
source as (
  select s.* from public.relationship_opportunity_sources_v1 s join session x on x.user_id is not null and s.user_id=x.user_id
  union all
  select s.* from public.appointment_recovery_opportunity_sources_v1 s join session x on x.user_id is not null and s.user_id=x.user_id
  union all
  select s.* from public.birthday_relationship_opportunity_sources_v1 s join session x on x.user_id is not null and s.user_id=x.user_id
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
  'reactivation',(select count(*) from (select distinct person_type,person_id from active where opportunity_type='reactivation')x),
  'reschedule',(select count(*) from (select distinct person_type,person_id from active where opportunity_type='reschedule')x),
  'birthday',(select count(*) from (select distinct person_type,person_id from active where opportunity_type='birthday')x),
  'birthday_today',(select count(*) from (select distinct person_type,person_id from active where opportunity_type='birthday' and due_date=(now() at time zone 'America/Sao_Paulo')::date)x),
  'snoozed',(select count(*) from (select distinct person_type,person_id from source where snoozed_until>now())x)
);
$$;

create or replace function public.record_relationship_birthday_contact_v1(p_patient_id uuid,p_recipient_phone text,p_message_body text,p_idempotency_key uuid)
returns table(message_id uuid,sent_at timestamptz,was_created boolean)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_uid uuid:=auth.uid(); v_patient public.patients%rowtype; v_contact_id uuid; v_phone text; v_message_id uuid; v_sent_at timestamptz; v_created boolean:=false;
  v_year text:=extract(year from (now() at time zone 'America/Sao_Paulo'))::integer::text; v_item_key text; v_person_key text;
begin
  if v_uid is null then raise exception 'RELATIONSHIP_SESSION_REQUIRED'; end if;
  if p_patient_id is null then raise exception 'RELATIONSHIP_PATIENT_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception 'RELATIONSHIP_IDEMPOTENCY_REQUIRED'; end if;
  if nullif(btrim(p_message_body),'') is null then raise exception 'RELATIONSHIP_MESSAGE_REQUIRED'; end if;
  if length(p_message_body)>12000 then raise exception 'RELATIONSHIP_MESSAGE_TOO_LONG'; end if;
  select * into v_patient from public.patients p where p.id=p_patient_id and p.user_id=v_uid and p.archived_at is null;
  if not found then raise exception 'RELATIONSHIP_PATIENT_NOT_FOUND'; end if;
  v_phone:=regexp_replace(coalesce(p_recipient_phone,''),'\D','','g'); if v_phone !~ '^[0-9]{8,15}$' then raise exception 'RELATIONSHIP_PHONE_INVALID'; end if;
  select c.id into v_contact_id from public.contacts c where c.user_id=v_uid and c.patient_id=p_patient_id and c.archived_at is null order by c.created_at desc limit 1;
  v_item_key:='birthday:'||p_patient_id::text||':'||v_year; v_person_key:='relationship:patient:'||p_patient_id::text;
  insert into public.communication_messages(user_id,patient_id,contact_id,channel,direction,context,source_type,source_id,item_key,template_key,recipient_phone_snapshot,message_body_snapshot,status,sent_at,idempotency_key)
  values(v_uid,p_patient_id,v_contact_id,'whatsapp','outbound','birthday_greeting','relationship_patient',p_patient_id,v_item_key,'birthday_greeting',v_phone,p_message_body,'sent_manual',now(),p_idempotency_key)
  on conflict(user_id,idempotency_key) do nothing returning id,communication_messages.sent_at into v_message_id,v_sent_at;
  if v_message_id is not null then v_created:=true; else select m.id,m.sent_at into v_message_id,v_sent_at from public.communication_messages m where m.user_id=v_uid and m.idempotency_key=p_idempotency_key; if v_message_id is null then raise exception 'RELATIONSHIP_CONTACT_RECORD_FAILED'; end if; end if;
  insert into public.communication_attention_state(user_id,item_key,last_contacted_at,snoozed_until,updated_at)
  values(v_uid,v_person_key,v_sent_at,null,now()) on conflict(user_id,item_key) do update set last_contacted_at=greatest(coalesce(public.communication_attention_state.last_contacted_at,excluded.last_contacted_at),excluded.last_contacted_at),snoozed_until=null,updated_at=now();
  if v_created and v_contact_id is not null then insert into public.crm_activities(user_id,contact_id,activity_type,channel,note,metadata,actor_user_id,occurred_at)
    values(v_uid,v_contact_id,'contact','whatsapp','Parabéns de aniversário registrado',jsonb_build_object('communication_message_id',v_message_id,'context','birthday_greeting','source_type','relationship_patient','source_id',p_patient_id),v_uid,v_sent_at); end if;
  return query select v_message_id,v_sent_at,v_created;
end;
$$;

revoke all on function public.record_relationship_birthday_contact_v1(uuid,text,text,uuid) from public;
grant execute on function public.record_relationship_birthday_contact_v1(uuid,text,text,uuid) to authenticated,service_role;

grant execute on function public.list_relationship_opportunities_v2(text,text,boolean,integer,integer) to authenticated,service_role;
grant execute on function public.get_relationship_opportunity_counts_v2() to authenticated,service_role;

commit;
