begin;

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
  'birthday:'||d.id::text||':'||(extract(year from d.birthday_on)::integer)::text opportunity_key,
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
  null::date expires_on,
  '/pacientes/'||d.id::text route,
  'birthday:'||d.id::text||':'||(extract(year from d.birthday_on)::integer)::text communication_item_key,
  'birthday_greeting'::text template_key,
  jsonb_build_object('birth_date',d.birth_date,'birthday_on',d.birthday_on) context
from due d
left join lateral (select c0.id from public.contacts c0 where c0.user_id=d.user_id and c0.patient_id=d.id and c0.archived_at is null order by c0.created_at desc limit 1) c on true
left join lateral (select max(p0.performed_at) last_visit_at from public.procedures p0 where p0.user_id=d.user_id and p0.patient_id=d.id) v on true
left join lateral (select min(a0.scheduled_at) next_appointment_at from public.appointments a0 where a0.user_id=d.user_id and a0.patient_id=d.id and a0.scheduled_at>=now() and a0.status in ('agendado','confirmado')) ap on true
left join public.communication_attention_state st on st.user_id=d.user_id and st.item_key='relationship:patient:'||d.id::text
where d.birthday_on between d.today and d.today+7
  and not exists (
    select 1
    from public.communication_messages m
    where m.user_id=d.user_id
      and m.patient_id=d.id
      and m.context='birthday_greeting'
      and m.item_key='birthday:'||d.id::text||':'||(extract(year from d.birthday_on)::integer)::text
      and m.status='sent_manual'
  );

revoke all on public.birthday_relationship_opportunity_sources_v1 from public, anon, authenticated;

create or replace function public.record_relationship_birthday_contact_v1(p_patient_id uuid,p_recipient_phone text,p_message_body text,p_idempotency_key uuid)
returns table(message_id uuid,sent_at timestamptz,was_created boolean)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_uid uuid:=auth.uid();
  v_patient public.patients%rowtype;
  v_contact_id uuid;
  v_phone text;
  v_message_id uuid;
  v_sent_at timestamptz;
  v_created boolean:=false;
  v_today date:=(now() at time zone 'America/Sao_Paulo')::date;
  v_birthday_on date;
  v_item_key text;
  v_person_key text;
begin
  if v_uid is null then raise exception 'RELATIONSHIP_SESSION_REQUIRED'; end if;
  if p_patient_id is null then raise exception 'RELATIONSHIP_PATIENT_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception 'RELATIONSHIP_IDEMPOTENCY_REQUIRED'; end if;
  if nullif(btrim(p_message_body),'') is null then raise exception 'RELATIONSHIP_MESSAGE_REQUIRED'; end if;
  if length(p_message_body)>12000 then raise exception 'RELATIONSHIP_MESSAGE_TOO_LONG'; end if;

  select * into v_patient from public.patients p where p.id=p_patient_id and p.user_id=v_uid and p.archived_at is null;
  if not found then raise exception 'RELATIONSHIP_PATIENT_NOT_FOUND'; end if;
  if v_patient.birth_date is null then raise exception 'RELATIONSHIP_BIRTH_DATE_REQUIRED'; end if;

  v_birthday_on:=public.birthday_date_for_year_v1(v_patient.birth_date,extract(year from v_today)::integer);
  if v_birthday_on<v_today then v_birthday_on:=public.birthday_date_for_year_v1(v_patient.birth_date,extract(year from v_today)::integer+1); end if;
  if v_birthday_on>v_today+7 then raise exception 'RELATIONSHIP_BIRTHDAY_NOT_DUE'; end if;

  v_phone:=regexp_replace(coalesce(p_recipient_phone,''),'\D','','g');
  if v_phone !~ '^[0-9]{8,15}$' then raise exception 'RELATIONSHIP_PHONE_INVALID'; end if;
  select c.id into v_contact_id from public.contacts c where c.user_id=v_uid and c.patient_id=p_patient_id and c.archived_at is null order by c.created_at desc limit 1;

  v_item_key:='birthday:'||p_patient_id::text||':'||(extract(year from v_birthday_on)::integer)::text;
  v_person_key:='relationship:patient:'||p_patient_id::text;

  insert into public.communication_messages(user_id,patient_id,contact_id,channel,direction,context,source_type,source_id,item_key,template_key,recipient_phone_snapshot,message_body_snapshot,status,sent_at,idempotency_key)
  values(v_uid,p_patient_id,v_contact_id,'whatsapp','outbound','birthday_greeting','relationship_patient',p_patient_id,v_item_key,'birthday_greeting',v_phone,p_message_body,'sent_manual',now(),p_idempotency_key)
  on conflict(user_id,idempotency_key) do nothing returning id,communication_messages.sent_at into v_message_id,v_sent_at;

  if v_message_id is not null then
    v_created:=true;
  else
    select m.id,m.sent_at into v_message_id,v_sent_at from public.communication_messages m where m.user_id=v_uid and m.idempotency_key=p_idempotency_key;
    if v_message_id is null then raise exception 'RELATIONSHIP_CONTACT_RECORD_FAILED'; end if;
  end if;

  insert into public.communication_attention_state(user_id,item_key,last_contacted_at,snoozed_until,updated_at)
  values(v_uid,v_person_key,v_sent_at,null,now())
  on conflict(user_id,item_key) do update set last_contacted_at=greatest(coalesce(public.communication_attention_state.last_contacted_at,excluded.last_contacted_at),excluded.last_contacted_at),snoozed_until=null,updated_at=now();

  if v_created and v_contact_id is not null then
    insert into public.crm_activities(user_id,contact_id,activity_type,channel,note,metadata,actor_user_id,occurred_at)
    values(v_uid,v_contact_id,'contact','whatsapp','Parabéns de aniversário registrado',jsonb_build_object('communication_message_id',v_message_id,'context','birthday_greeting','source_type','relationship_patient','source_id',p_patient_id),v_uid,v_sent_at);
  end if;

  return query select v_message_id,v_sent_at,v_created;
end;
$$;

commit;
