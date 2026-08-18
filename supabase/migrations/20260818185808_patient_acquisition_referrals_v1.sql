-- Hub Giulia 4.2 — Origem de Pacientes & Indicações
-- Aquisição factual, indicação explícita, preservação Contact -> Patient e read models.

-- Canonical acquisition taxonomy used by both Patient and new CRM writes:
-- instagram, referral, google, partnership, existing_patient, campaign, other.
-- `contacts.source='whatsapp'` remains DB-compatible only as a legacy value because
-- previous CRM versions used a communication channel as source. New UI/RPC v2 do not write it.

alter table public.patients
  add column if not exists acquisition_source text,
  add column if not exists acquisition_source_detail text,
  add column if not exists referred_by_patient_id uuid,
  add column if not exists referrer_name text;

alter table public.contacts
  add column if not exists referred_by_patient_id uuid,
  add column if not exists referrer_name text;

-- Unknown CRM origin must be representable without inventing `other`.
alter table public.contacts alter column source drop not null;
alter table public.contacts alter column source drop default;

alter table public.patients drop constraint if exists patients_acquisition_source_check;
alter table public.patients add constraint patients_acquisition_source_check check (
  acquisition_source is null or acquisition_source = any (array[
    'instagram'::text, 'referral'::text, 'google'::text, 'partnership'::text,
    'existing_patient'::text, 'campaign'::text, 'other'::text
  ])
);

alter table public.patients drop constraint if exists patients_acquisition_referral_semantics_check;
alter table public.patients add constraint patients_acquisition_referral_semantics_check check (
  acquisition_source = 'referral'::text
  or (acquisition_source is distinct from 'referral'::text and referred_by_patient_id is null and referrer_name is null)
);

alter table public.patients drop constraint if exists patients_acquisition_referrer_exclusive_check;
alter table public.patients add constraint patients_acquisition_referrer_exclusive_check check (
  referred_by_patient_id is null or referrer_name is null
);

alter table public.patients drop constraint if exists patients_acquisition_self_referral_check;
alter table public.patients add constraint patients_acquisition_self_referral_check check (
  referred_by_patient_id is null or referred_by_patient_id <> id
);

alter table public.patients drop constraint if exists patients_acquisition_referrer_name_check;
alter table public.patients add constraint patients_acquisition_referrer_name_check check (
  referrer_name is null or nullif(btrim(referrer_name), '') is not null
);

alter table public.patients drop constraint if exists patients_acquisition_detail_semantics_check;
alter table public.patients add constraint patients_acquisition_detail_semantics_check check (
  acquisition_source = any (array['partnership'::text, 'campaign'::text, 'other'::text])
  or acquisition_source_detail is null
);

alter table public.patients drop constraint if exists patients_acquisition_referrer_owner_fkey;
alter table public.patients add constraint patients_acquisition_referrer_owner_fkey
  foreign key (referred_by_patient_id, user_id)
  references public.patients(id, user_id);

-- Preserve the one known legacy CRM source while admitting the canonical partnership source.
alter table public.contacts drop constraint if exists contacts_source_check;
alter table public.contacts add constraint contacts_source_check check (
  source is null or source = any (array[
    'instagram'::text, 'whatsapp'::text, 'referral'::text, 'google'::text,
    'partnership'::text, 'existing_patient'::text, 'campaign'::text, 'other'::text
  ])
);

alter table public.contacts drop constraint if exists contacts_referral_semantics_check;
alter table public.contacts add constraint contacts_referral_semantics_check check (
  source = 'referral'::text
  or (source is distinct from 'referral'::text and referred_by_patient_id is null and referrer_name is null)
);

alter table public.contacts drop constraint if exists contacts_referrer_exclusive_check;
alter table public.contacts add constraint contacts_referrer_exclusive_check check (
  referred_by_patient_id is null or referrer_name is null
);

alter table public.contacts drop constraint if exists contacts_referrer_name_check;
alter table public.contacts add constraint contacts_referrer_name_check check (
  referrer_name is null or nullif(btrim(referrer_name), '') is not null
);

alter table public.contacts drop constraint if exists contacts_referrer_owner_fkey;
alter table public.contacts add constraint contacts_referrer_owner_fkey
  foreign key (referred_by_patient_id, user_id)
  references public.patients(id, user_id);

create index if not exists patients_user_acquisition_created_idx
  on public.patients(user_id, acquisition_source, created_at desc);
create index if not exists patients_user_referrer_idx
  on public.patients(user_id, referred_by_patient_id)
  where referred_by_patient_id is not null;
create index if not exists contacts_user_referrer_idx
  on public.contacts(user_id, referred_by_patient_id)
  where referred_by_patient_id is not null;

-- New atomic CRM write contract. v1 remains intact for pre-deploy compatibility.
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
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_contact_id uuid;
  v_deal_id uuid;
  v_interest jsonb;
  v_service_id uuid;
  v_service_name text;
  v_label text;
  v_source text := nullif(btrim(p_source), '');
  v_source_detail text := nullif(btrim(p_source_detail), '');
  v_referrer_id uuid := p_referred_by_patient_id;
  v_referrer_name text := nullif(btrim(p_referrer_name), '');
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if nullif(btrim(p_name), '') is null then raise exception 'CRM_NAME_REQUIRED' using errcode='23514'; end if;
  if p_idempotency_key is null then raise exception 'CRM_IDEMPOTENCY_REQUIRED' using errcode='23514'; end if;
  if v_source is not null and not (v_source = any(array['instagram','referral','google','partnership','existing_patient','campaign','other'])) then
    raise exception 'CRM_ACQUISITION_SOURCE_INVALID' using errcode='23514';
  end if;
  if v_source is distinct from 'referral' then
    v_referrer_id := null; v_referrer_name := null;
  elsif v_referrer_id is not null then
    v_referrer_name := null;
  end if;
  if v_source is null or not (v_source = any(array['partnership','campaign','other'])) then v_source_detail := null; end if;
  if v_referrer_id is not null and not exists(select 1 from public.patients p where p.id=v_referrer_id and p.user_id=v_user_id) then
    raise exception 'CRM_REFERRER_NOT_FOUND' using errcode='23503';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_idempotency_key::text, 0));
  select d.contact_id, d.id into v_contact_id, v_deal_id from public.deals d where d.user_id=v_user_id and d.idempotency_key=p_idempotency_key;
  if v_deal_id is not null then return jsonb_build_object('contact_id',v_contact_id,'deal_id',v_deal_id,'reused',true); end if;

  insert into public.contacts(user_id,name,phone,email,instagram,source,source_detail,referred_by_patient_id,referrer_name)
  values(v_user_id,btrim(p_name),nullif(btrim(p_phone),''),nullif(lower(btrim(p_email)),''),nullif(btrim(p_instagram),''),v_source,v_source_detail,v_referrer_id,v_referrer_name)
  returning id into v_contact_id;

  insert into public.deals(user_id,contact_id,title,value,stage,expected_close,idempotency_key)
  values(v_user_id,v_contact_id,coalesce(nullif(btrim(p_title),''),'Oportunidade · '||btrim(p_name)),p_value,'new',p_expected_close,p_idempotency_key)
  returning id into v_deal_id;

  if jsonb_typeof(coalesce(p_interests,'[]'::jsonb)) <> 'array' then raise exception 'CRM_INTERESTS_INVALID' using errcode='22023'; end if;
  for v_interest in select value from jsonb_array_elements(coalesce(p_interests,'[]'::jsonb)) loop
    v_service_id := nullif(v_interest->>'service_id','')::uuid;
    v_label := nullif(btrim(v_interest->>'label'),'');
    v_service_name := null;
    if v_service_id is not null then
      select s.name into v_service_name from public.services s where s.id=v_service_id and s.user_id=v_user_id;
      if v_service_name is null then raise exception 'CRM_SERVICE_NOT_FOUND' using errcode='23503'; end if;
    end if;
    if coalesce(v_label,v_service_name) is not null then
      insert into public.crm_deal_interests(user_id,deal_id,service_id,label_snapshot) values(v_user_id,v_deal_id,v_service_id,coalesce(v_label,v_service_name));
    end if;
  end loop;
  if nullif(btrim(p_note),'') is not null then
    insert into public.crm_activities(user_id,contact_id,deal_id,activity_type,note,actor_user_id) values(v_user_id,v_contact_id,v_deal_id,'note',btrim(p_note),v_user_id);
  end if;
  return jsonb_build_object('contact_id',v_contact_id,'deal_id',v_deal_id,'reused',false);
end;
$$;

revoke all on function public.create_crm_lead_v2(text,text,text,text,text,text,uuid,text,text,numeric,date,jsonb,text,uuid) from public, anon;
grant execute on function public.create_crm_lead_v2(text,text,text,text,text,text,uuid,text,text,numeric,date,jsonb,text,uuid) to authenticated;

-- Preserve acquisition only when conversion creates a brand-new Patient.
create or replace function public.convert_crm_contact_to_patient_v1(p_contact_id uuid, p_existing_patient_id uuid default null)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_contact public.contacts%rowtype;
  v_patient_id uuid;
  v_acquisition_source text;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  select * into v_contact from public.contacts c where c.id=p_contact_id and c.user_id=v_user_id for update;
  if not found then raise exception 'CRM_CONTACT_NOT_FOUND' using errcode='P0002'; end if;
  if v_contact.patient_id is not null then return v_contact.patient_id; end if;

  if p_existing_patient_id is not null then
    select p.id into v_patient_id from public.patients p where p.id=p_existing_patient_id and p.user_id=v_user_id;
    if v_patient_id is null then raise exception 'CRM_PATIENT_NOT_FOUND' using errcode='P0002'; end if;
  else
    -- `whatsapp` is a legacy channel value, not a factual acquisition source; never invent a mapping.
    v_acquisition_source := case when v_contact.source = any(array['instagram','referral','google','partnership','existing_patient','campaign','other']) then v_contact.source else null end;
    insert into public.patients(
      user_id,name,phone,email,instagram,
      acquisition_source,acquisition_source_detail,referred_by_patient_id,referrer_name
    ) values(
      v_user_id,v_contact.name,v_contact.phone,v_contact.email,v_contact.instagram,
      v_acquisition_source,
      case when v_acquisition_source = any(array['partnership','campaign','other']) then v_contact.source_detail else null end,
      case when v_acquisition_source='referral' then v_contact.referred_by_patient_id else null end,
      case when v_acquisition_source='referral' and v_contact.referred_by_patient_id is null then v_contact.referrer_name else null end
    ) returning id into v_patient_id;
  end if;

  update public.contacts set patient_id=v_patient_id where id=p_contact_id and user_id=v_user_id;
  insert into public.crm_activities(user_id,contact_id,activity_type,note,metadata,actor_user_id)
  values(v_user_id,p_contact_id,'patient_linked',case when p_existing_patient_id is null then 'Contato convertido em paciente.' else 'Contato vinculado a paciente existente.' end,jsonb_build_object('patient_id',v_patient_id,'created_patient',p_existing_patient_id is null),v_user_id);
  return v_patient_id;
end;
$$;

revoke all on function public.convert_crm_contact_to_patient_v1(uuid,uuid) from public, anon;
grant execute on function public.convert_crm_contact_to_patient_v1(uuid,uuid) to authenticated;

-- Append referral data to the existing CRM read model without changing existing columns.
create or replace view public.crm_pipeline_v
with (security_invoker=true)
as
select
  d.id as deal_id, d.user_id, d.contact_id, d.title, d.value as estimated_value, d.stage, d.expected_close,
  d.lost_reason, d.lost_reason_detail, d.won_at, d.lost_at, d.closed_at, d.created_at as deal_created_at, d.updated_at as deal_updated_at,
  c.patient_id, c.name as contact_name, c.phone, c.email, c.instagram, c.source, c.source_detail, c.archived_at as contact_archived_at,
  pat.name as patient_name,
  coalesce(i.interests,'[]'::jsonb) as interests,
  f.next_followup_on, a.last_activity_at,
  q.proposal_id, q.version_id as proposal_version_id, q.title as proposal_title, q.version_number as proposal_version_number,
  q.status as proposal_status, q.effective_status as proposal_effective_status, q.total_value as proposal_total_value,
  q.valid_until as proposal_valid_until, q.sent_at as proposal_sent_at,
  c.referred_by_patient_id, c.referrer_name, referrer.name as referrer_patient_name
from public.deals d
join public.contacts c on c.id=d.contact_id and c.user_id=d.user_id
left join public.patients pat on pat.id=c.patient_id and pat.user_id=c.user_id
left join public.patients referrer on referrer.id=c.referred_by_patient_id and referrer.user_id=c.user_id
left join lateral (
  select jsonb_agg(jsonb_build_object('id',x.id,'service_id',x.service_id,'label',x.label_snapshot) order by x.created_at,x.id) as interests
  from public.crm_deal_interests x where x.user_id=d.user_id and x.deal_id=d.id
) i on true
left join lateral (
  select min(fu.due_on) as next_followup_on from public.crm_followups fu where fu.user_id=d.user_id and fu.deal_id=d.id and fu.status='open'
) f on true
left join lateral (
  select max(ac.occurred_at) as last_activity_at from public.crm_activities ac where ac.user_id=d.user_id and ac.deal_id=d.id
) a on true
left join lateral (
  select s.* from public.treatment_proposal_summary_v s where s.user_id=d.user_id and s.deal_id=d.id order by s.proposal_updated_at desc,s.proposal_id desc limit 1
) q on true;

grant select on public.crm_pipeline_v to authenticated;

create or replace function public.get_patient_referral_summary_v1(p_patient_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_patient public.patients%rowtype;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  select * into v_patient from public.patients p where p.id=p_patient_id and p.user_id=v_user_id;
  if not found then raise exception 'PATIENT_NOT_FOUND' using errcode='P0002'; end if;
  return jsonb_build_object(
    'referrer', (select case when r.id is null then null else jsonb_build_object('id',r.id,'name',r.name,'archived',r.archived_at is not null) end from (select 1) x left join public.patients r on r.id=v_patient.referred_by_patient_id and r.user_id=v_user_id),
    'referred_count', (select count(*)::integer from public.patients p where p.user_id=v_user_id and p.referred_by_patient_id=p_patient_id),
    'referred_attended_count', (select count(*)::integer from public.patients p where p.user_id=v_user_id and p.referred_by_patient_id=p_patient_id and exists(select 1 from public.procedures pr where pr.user_id=v_user_id and pr.patient_id=p.id)),
    'referred_patients', coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'archived',p.archived_at is not null,'has_attendance',exists(select 1 from public.procedures pr where pr.user_id=v_user_id and pr.patient_id=p.id)) order by p.created_at desc,p.id) from public.patients p where p.user_id=v_user_id and p.referred_by_patient_id=p_patient_id),'[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_patient_referral_summary_v1(uuid) from public, anon;
grant execute on function public.get_patient_referral_summary_v1(uuid) to authenticated;

create or replace function public.get_acquisition_summary_v1(p_start_date date, p_end_date_exclusive date)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_start timestamptz;
  v_end timestamptz;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if p_start_date is null or p_end_date_exclusive is null or p_start_date >= p_end_date_exclusive then raise exception 'ACQUISITION_PERIOD_INVALID' using errcode='22023'; end if;
  if p_end_date_exclusive - p_start_date > 366 then raise exception 'ACQUISITION_PERIOD_TOO_LARGE' using errcode='22023'; end if;
  v_start := p_start_date::timestamp at time zone 'America/Sao_Paulo';
  v_end := p_end_date_exclusive::timestamp at time zone 'America/Sao_Paulo';

  return (
    with source_order(source,label,ord) as (values
      ('referral'::text,'Indicação'::text,1),
      ('instagram'::text,'Instagram'::text,2),
      ('google'::text,'Google'::text,3),
      ('partnership'::text,'Parceria'::text,4),
      ('existing_patient'::text,'Já conhecia / paciente antiga'::text,5),
      ('campaign'::text,'Campanha'::text,6),
      ('other'::text,'Outro'::text,7),
      (null::text,'Não informado'::text,99)
    ), registrations as (
      select p.acquisition_source as source, count(*)::integer as registrations
      from public.patients p
      where p.user_id=v_user_id and p.created_at>=v_start and p.created_at<v_end
      group by p.acquisition_source
    ), production as (
      select pat.acquisition_source as source,
        count(distinct pr.patient_id)::integer as attended_patients,
        count(distinct pr.id)::integer as procedures,
        coalesce(sum(pi.final_price),0)::numeric(14,2) as production_value
      from public.procedures pr
      join public.patients pat on pat.id=pr.patient_id and pat.user_id=pr.user_id
      left join public.procedure_items pi on pi.procedure_id=pr.id and pi.user_id=pr.user_id
      where pr.user_id=v_user_id and pr.performed_at>=v_start and pr.performed_at<v_end
      group by pat.acquisition_source
    ), source_rows as (
      select s.source,s.label,s.ord,coalesce(r.registrations,0)::integer as registrations,
        coalesce(p.attended_patients,0)::integer as attended_patients,
        coalesce(p.procedures,0)::integer as procedures,
        coalesce(p.production_value,0)::numeric(14,2) as production_value
      from source_order s
      left join registrations r on r.source is not distinct from s.source
      left join production p on p.source is not distinct from s.source
    ), top_referrers as (
      select ref.id as patient_id,ref.name,
        count(distinct child.id) filter(where child.created_at>=v_start and child.created_at<v_end)::integer as referred_registered,
        count(distinct child.id) filter(where exists(select 1 from public.procedures pr where pr.user_id=v_user_id and pr.patient_id=child.id and pr.performed_at>=v_start and pr.performed_at<v_end))::integer as referred_with_attendance
      from public.patients child
      join public.patients ref on ref.id=child.referred_by_patient_id and ref.user_id=child.user_id
      where child.user_id=v_user_id and child.acquisition_source='referral'
      group by ref.id,ref.name
      having count(distinct child.id) filter(where child.created_at>=v_start and child.created_at<v_end)>0
         or count(distinct child.id) filter(where exists(select 1 from public.procedures pr where pr.user_id=v_user_id and pr.patient_id=child.id and pr.performed_at>=v_start and pr.performed_at<v_end))>0
      order by referred_registered desc,referred_with_attendance desc,ref.name
      limit 10
    )
    select jsonb_build_object(
      'period',jsonb_build_object('start_date',p_start_date,'end_date_exclusive',p_end_date_exclusive,'timezone','America/Sao_Paulo'),
      'sources',(select jsonb_agg(jsonb_build_object('source',source,'label',label,'registrations',registrations,'attended_patients',attended_patients,'procedures',procedures,'production_value',production_value) order by ord) from source_rows),
      'top_referrers',coalesce((select jsonb_agg(jsonb_build_object('patient_id',patient_id,'name',name,'referred_registered',referred_registered,'referred_with_attendance',referred_with_attendance) order by referred_registered desc,referred_with_attendance desc,name) from top_referrers),'[]'::jsonb)
    )
  );
end;
$$;
revoke all on function public.get_acquisition_summary_v1(date,date) from public, anon;
grant execute on function public.get_acquisition_summary_v1(date,date) to authenticated;

comment on column public.patients.acquisition_source is 'Principal factual acquisition source; nullable for unknown/legacy history.';
comment on column public.patients.referred_by_patient_id is 'Explicit canonical Patient who referred this Patient; same-tenant FK, no fuzzy matching.';
comment on function public.get_acquisition_summary_v1(date,date) is 'Hub Giulia 4.2 acquisition read model. Registration uses patients.created_at; production uses procedures.performed_at and procedure_items.final_price. Not revenue attribution.';
