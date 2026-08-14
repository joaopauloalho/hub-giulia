-- Hub Giulia 3.0 — CRM 2.0
-- Evolução não destrutiva de contacts/deals + pipeline comercial operacional.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Contacts: identidade comercial, opcionalmente vinculada à identidade clínica.
-- ---------------------------------------------------------------------------
alter table public.contacts
  add column if not exists patient_id uuid,
  add column if not exists instagram text,
  add column if not exists source text,
  add column if not exists source_detail text,
  add column if not exists archived_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

update public.contacts
set source = coalesce(source, 'other'),
    updated_at = coalesce(updated_at, created_at, now());

alter table public.contacts
  alter column source set default 'other',
  alter column source set not null,
  alter column created_at set not null;

alter table public.contacts drop constraint if exists contacts_source_check;
alter table public.contacts
  add constraint contacts_source_check
  check (source = any (array[
    'instagram'::text,
    'whatsapp'::text,
    'referral'::text,
    'google'::text,
    'existing_patient'::text,
    'campaign'::text,
    'other'::text
  ]));

alter table public.contacts drop constraint if exists contacts_patient_owner_fkey;
alter table public.contacts
  add constraint contacts_patient_owner_fkey
  foreign key (patient_id, user_id)
  references public.patients(id, user_id);

create index if not exists contacts_user_created_idx
  on public.contacts(user_id, created_at desc);

create index if not exists contacts_user_source_created_idx
  on public.contacts(user_id, source, created_at desc);

create index if not exists contacts_patient_user_idx
  on public.contacts(patient_id, user_id)
  where patient_id is not null;

create unique index if not exists contacts_user_patient_uidx
  on public.contacts(user_id, patient_id)
  where patient_id is not null;

create index if not exists contacts_user_phone_digits_idx
  on public.contacts(user_id, (regexp_replace(coalesce(phone, ''), '\D', '', 'g')));

create index if not exists contacts_user_email_normalized_idx
  on public.contacts(user_id, (lower(btrim(coalesce(email, '')))));

-- ---------------------------------------------------------------------------
-- Deals: uma oportunidade comercial. `value` permanece e passa a significar
-- valor estimado da oportunidade (não orçamento/procedimento).
-- ---------------------------------------------------------------------------
update public.deals
set stage = case
  when stage is null or stage = 'lead' then 'new'
  when stage in ('new','contacted','assessment_scheduled','proposal_sent','negotiation','won','lost') then stage
  else 'new'
end;

alter table public.deals
  add column if not exists lost_reason text,
  add column if not exists lost_reason_detail text,
  add column if not exists won_at timestamptz,
  add column if not exists lost_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists idempotency_key uuid,
  add column if not exists updated_at timestamptz not null default now();

update public.deals
set updated_at = coalesce(updated_at, created_at, now()),
    won_at = case when stage = 'won' then coalesce(won_at, created_at, now()) else won_at end,
    lost_reason = case when stage = 'lost' and lost_reason is null then 'other' else lost_reason end,
    lost_reason_detail = case when stage = 'lost' and lost_reason_detail is null then 'Motivo não registrado no CRM legado.' else lost_reason_detail end,
    lost_at = case when stage = 'lost' then coalesce(lost_at, created_at, now()) else lost_at end,
    closed_at = case
      when stage = 'won' then coalesce(closed_at, won_at, created_at, now())
      when stage = 'lost' then coalesce(closed_at, lost_at, created_at, now())
      else closed_at
    end;

alter table public.deals
  alter column stage set default 'new',
  alter column stage set not null,
  alter column contact_id set not null,
  alter column created_at set not null;

alter table public.deals drop constraint if exists deals_stage_check;
alter table public.deals
  add constraint deals_stage_check
  check (stage = any (array[
    'new'::text,
    'contacted'::text,
    'assessment_scheduled'::text,
    'proposal_sent'::text,
    'negotiation'::text,
    'won'::text,
    'lost'::text
  ]));

alter table public.deals drop constraint if exists deals_lost_reason_check;
alter table public.deals
  add constraint deals_lost_reason_check
  check (
    lost_reason is null or
    lost_reason = any (array[
      'price'::text,
      'postponed'::text,
      'no_response'::text,
      'competitor'::text,
      'not_interested'::text,
      'clinical_decision'::text,
      'other'::text
    ])
  );

alter table public.deals drop constraint if exists deals_lost_requires_reason_check;
alter table public.deals
  add constraint deals_lost_requires_reason_check
  check (stage <> 'lost' or lost_reason is not null);

alter table public.deals drop constraint if exists deals_other_loss_detail_check;
alter table public.deals
  add constraint deals_other_loss_detail_check
  check (lost_reason <> 'other' or nullif(btrim(lost_reason_detail), '') is not null);

create unique index if not exists deals_id_user_id_uidx
  on public.deals(id, user_id);

create index if not exists deals_user_stage_created_idx
  on public.deals(user_id, stage, created_at desc);

create index if not exists deals_user_contact_created_idx
  on public.deals(user_id, contact_id, created_at desc);

create unique index if not exists deals_user_idempotency_uidx
  on public.deals(user_id, idempotency_key)
  where idempotency_key is not null;

-- ---------------------------------------------------------------------------
-- Structured interests
-- ---------------------------------------------------------------------------
create table if not exists public.crm_deal_interests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  deal_id uuid not null,
  service_id uuid,
  label_snapshot text not null,
  created_at timestamptz not null default now(),
  constraint crm_deal_interests_label_check check (nullif(btrim(label_snapshot), '') is not null),
  constraint crm_deal_interests_deal_owner_fkey
    foreign key (deal_id, user_id) references public.deals(id, user_id) on delete cascade,
  constraint crm_deal_interests_service_owner_fkey
    foreign key (service_id, user_id) references public.services(id, user_id)
);

create index if not exists crm_deal_interests_user_deal_idx
  on public.crm_deal_interests(user_id, deal_id);

create index if not exists crm_deal_interests_service_user_idx
  on public.crm_deal_interests(service_id, user_id)
  where service_id is not null;

alter table public.crm_deal_interests enable row level security;
drop policy if exists crm_deal_interests_select_own on public.crm_deal_interests;
drop policy if exists crm_deal_interests_insert_own on public.crm_deal_interests;
drop policy if exists crm_deal_interests_update_own on public.crm_deal_interests;
drop policy if exists crm_deal_interests_delete_own on public.crm_deal_interests;
create policy crm_deal_interests_select_own on public.crm_deal_interests
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy crm_deal_interests_insert_own on public.crm_deal_interests
  for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy crm_deal_interests_update_own on public.crm_deal_interests
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy crm_deal_interests_delete_own on public.crm_deal_interests
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Human commercial timeline. System/stage events are append-only.
-- ---------------------------------------------------------------------------
create table if not exists public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contact_id uuid not null,
  deal_id uuid,
  activity_type text not null,
  channel text,
  note text,
  from_stage text,
  to_stage text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  constraint crm_activities_contact_owner_fkey
    foreign key (contact_id, user_id) references public.contacts(id, user_id) on delete cascade,
  constraint crm_activities_deal_owner_fkey
    foreign key (deal_id, user_id) references public.deals(id, user_id) on delete cascade,
  constraint crm_activities_type_check check (activity_type = any (array[
    'note'::text,
    'contact'::text,
    'whatsapp_opened'::text,
    'call'::text,
    'stage_changed'::text,
    'followup_created'::text,
    'followup_completed'::text,
    'followup_cancelled'::text,
    'patient_linked'::text
  ])),
  constraint crm_activities_channel_check check (
    channel is null or channel = any (array['whatsapp'::text,'phone'::text,'instagram'::text,'other'::text])
  )
);

create index if not exists crm_activities_user_deal_occurred_idx
  on public.crm_activities(user_id, deal_id, occurred_at desc);

create index if not exists crm_activities_user_contact_occurred_idx
  on public.crm_activities(user_id, contact_id, occurred_at desc);

alter table public.crm_activities enable row level security;
drop policy if exists crm_activities_select_own on public.crm_activities;
drop policy if exists crm_activities_insert_own on public.crm_activities;
create policy crm_activities_select_own on public.crm_activities
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy crm_activities_insert_own on public.crm_activities
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and actor_user_id = (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Commercial follow-ups. Date-only is intentional in CRM 2.0:
-- attention is day-based in America/Sao_Paulo and no fake time is invented.
-- ---------------------------------------------------------------------------
create table if not exists public.crm_followups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  deal_id uuid not null,
  due_on date not null,
  status text not null default 'open',
  channel text,
  note text,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_followups_deal_owner_fkey
    foreign key (deal_id, user_id) references public.deals(id, user_id) on delete cascade,
  constraint crm_followups_status_check check (status = any (array['open'::text,'completed'::text,'cancelled'::text])),
  constraint crm_followups_channel_check check (
    channel is null or channel = any (array['whatsapp'::text,'phone'::text,'instagram'::text,'other'::text])
  ),
  constraint crm_followups_completion_state_check check (
    (status = 'completed' and completed_at is not null and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null and completed_at is null)
    or (status = 'open' and completed_at is null and cancelled_at is null)
  )
);

create index if not exists crm_followups_user_status_due_idx
  on public.crm_followups(user_id, status, due_on);

create index if not exists crm_followups_user_deal_idx
  on public.crm_followups(user_id, deal_id, created_at desc);

alter table public.crm_followups enable row level security;
drop policy if exists crm_followups_select_own on public.crm_followups;
drop policy if exists crm_followups_insert_own on public.crm_followups;
drop policy if exists crm_followups_update_own on public.crm_followups;
create policy crm_followups_select_own on public.crm_followups
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy crm_followups_insert_own on public.crm_followups
  for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy crm_followups_update_own on public.crm_followups
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Touch + integrity triggers
-- ---------------------------------------------------------------------------
create or replace function public.crm_touch_updated_at_v2()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.crm_prepare_deal_v2()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();

  if new.stage = 'lost' then
    if new.lost_reason is null then
      raise exception 'CRM_LOST_REASON_REQUIRED' using errcode = '23514';
    end if;
    if new.lost_reason = 'other' and nullif(btrim(new.lost_reason_detail), '') is null then
      raise exception 'CRM_LOST_REASON_DETAIL_REQUIRED' using errcode = '23514';
    end if;
    if tg_op = 'INSERT' or old.stage is distinct from 'lost' then
      new.lost_at := now();
    end if;
    new.won_at := null;
    new.closed_at := coalesce(new.closed_at, new.lost_at, now());
  elsif new.stage = 'won' then
    if tg_op = 'INSERT' or old.stage is distinct from 'won' then
      new.won_at := now();
    end if;
    new.lost_at := null;
    new.lost_reason := null;
    new.lost_reason_detail := null;
    new.closed_at := coalesce(new.closed_at, new.won_at, now());
  else
    if tg_op = 'UPDATE' and old.stage is distinct from new.stage then
      new.won_at := null;
      new.lost_at := null;
      new.closed_at := null;
      new.lost_reason := null;
      new.lost_reason_detail := null;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.crm_log_stage_change_v2()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' or old.stage is distinct from new.stage then
    insert into public.crm_activities (
      user_id, contact_id, deal_id, activity_type, from_stage, to_stage, metadata, actor_user_id
    ) values (
      new.user_id,
      new.contact_id,
      new.id,
      'stage_changed',
      case when tg_op = 'INSERT' then null else old.stage end,
      new.stage,
      jsonb_strip_nulls(jsonb_build_object(
        'lost_reason', new.lost_reason,
        'lost_reason_detail', new.lost_reason_detail
      )),
      new.user_id
    );
  end if;
  return new;
end;
$$;

create or replace function public.crm_prepare_followup_v2()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  if new.status = 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
    new.cancelled_at := null;
  elsif new.status = 'cancelled' then
    new.cancelled_at := coalesce(new.cancelled_at, now());
    new.completed_at := null;
  else
    new.completed_at := null;
    new.cancelled_at := null;
  end if;
  return new;
end;
$$;

create or replace function public.crm_log_followup_activity_v2()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_contact_id uuid;
  v_type text;
begin
  select d.contact_id into v_contact_id
  from public.deals d
  where d.id = new.deal_id and d.user_id = new.user_id;

  if tg_op = 'INSERT' then
    v_type := 'followup_created';
  elsif old.status is distinct from new.status and new.status = 'completed' then
    v_type := 'followup_completed';
  elsif old.status is distinct from new.status and new.status = 'cancelled' then
    v_type := 'followup_cancelled';
  else
    return new;
  end if;

  insert into public.crm_activities (
    user_id, contact_id, deal_id, activity_type, channel, note, metadata, actor_user_id
  ) values (
    new.user_id,
    v_contact_id,
    new.deal_id,
    v_type,
    new.channel,
    new.note,
    jsonb_build_object('followup_id', new.id, 'due_on', new.due_on, 'status', new.status),
    new.user_id
  );

  return new;
end;
$$;

drop trigger if exists trg_contacts_touch_crm_v2 on public.contacts;
create trigger trg_contacts_touch_crm_v2
before update on public.contacts
for each row execute function public.crm_touch_updated_at_v2();

drop trigger if exists trg_deals_prepare_crm_v2 on public.deals;
create trigger trg_deals_prepare_crm_v2
before insert or update on public.deals
for each row execute function public.crm_prepare_deal_v2();

drop trigger if exists trg_deals_stage_activity_crm_v2 on public.deals;
create trigger trg_deals_stage_activity_crm_v2
after insert or update of stage on public.deals
for each row execute function public.crm_log_stage_change_v2();

drop trigger if exists trg_followups_prepare_crm_v2 on public.crm_followups;
create trigger trg_followups_prepare_crm_v2
before insert or update on public.crm_followups
for each row execute function public.crm_prepare_followup_v2();

drop trigger if exists trg_followups_activity_crm_v2 on public.crm_followups;
create trigger trg_followups_activity_crm_v2
after insert or update of status on public.crm_followups
for each row execute function public.crm_log_followup_activity_v2();

-- ---------------------------------------------------------------------------
-- Atomic lead creation. Idempotency key is supplied by UI and protected by
-- an advisory transaction lock + unique per-owner key.
-- ---------------------------------------------------------------------------
create or replace function public.create_crm_lead_v1(
  p_name text,
  p_phone text default null,
  p_email text default null,
  p_instagram text default null,
  p_source text default 'other',
  p_source_detail text default null,
  p_title text default null,
  p_value numeric default null,
  p_expected_close date default null,
  p_interests jsonb default '[]'::jsonb,
  p_note text default null,
  p_idempotency_key uuid default gen_random_uuid()
)
returns jsonb
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
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if nullif(btrim(p_name), '') is null then
    raise exception 'CRM_NAME_REQUIRED' using errcode = '23514';
  end if;
  if p_idempotency_key is null then
    raise exception 'CRM_IDEMPOTENCY_REQUIRED' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_idempotency_key::text, 0));

  select d.contact_id, d.id into v_contact_id, v_deal_id
  from public.deals d
  where d.user_id = v_user_id and d.idempotency_key = p_idempotency_key;

  if v_deal_id is not null then
    return jsonb_build_object('contact_id', v_contact_id, 'deal_id', v_deal_id, 'reused', true);
  end if;

  insert into public.contacts (
    user_id, name, phone, email, instagram, source, source_detail
  ) values (
    v_user_id,
    btrim(p_name),
    nullif(btrim(p_phone), ''),
    nullif(lower(btrim(p_email)), ''),
    nullif(btrim(p_instagram), ''),
    p_source,
    nullif(btrim(p_source_detail), '')
  )
  returning id into v_contact_id;

  insert into public.deals (
    user_id, contact_id, title, value, stage, expected_close, idempotency_key
  ) values (
    v_user_id,
    v_contact_id,
    coalesce(nullif(btrim(p_title), ''), 'Oportunidade · ' || btrim(p_name)),
    p_value,
    'new',
    p_expected_close,
    p_idempotency_key
  )
  returning id into v_deal_id;

  if jsonb_typeof(coalesce(p_interests, '[]'::jsonb)) <> 'array' then
    raise exception 'CRM_INTERESTS_INVALID' using errcode = '22023';
  end if;

  for v_interest in select value from jsonb_array_elements(coalesce(p_interests, '[]'::jsonb))
  loop
    v_service_id := nullif(v_interest->>'service_id', '')::uuid;
    v_label := nullif(btrim(v_interest->>'label'), '');
    v_service_name := null;

    if v_service_id is not null then
      select s.name into v_service_name
      from public.services s
      where s.id = v_service_id and s.user_id = v_user_id;
      if v_service_name is null then
        raise exception 'CRM_SERVICE_NOT_FOUND' using errcode = '23503';
      end if;
    end if;

    if coalesce(v_label, v_service_name) is not null then
      insert into public.crm_deal_interests (user_id, deal_id, service_id, label_snapshot)
      values (v_user_id, v_deal_id, v_service_id, coalesce(v_label, v_service_name));
    end if;
  end loop;

  if nullif(btrim(p_note), '') is not null then
    insert into public.crm_activities (
      user_id, contact_id, deal_id, activity_type, note, actor_user_id
    ) values (
      v_user_id, v_contact_id, v_deal_id, 'note', btrim(p_note), v_user_id
    );
  end if;

  return jsonb_build_object('contact_id', v_contact_id, 'deal_id', v_deal_id, 'reused', false);
end;
$$;

-- Creates a new opportunity for an existing contact without duplicating identity.
create or replace function public.create_crm_deal_v1(
  p_contact_id uuid,
  p_title text,
  p_value numeric default null,
  p_expected_close date default null,
  p_interests jsonb default '[]'::jsonb,
  p_note text default null,
  p_idempotency_key uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_deal_id uuid;
  v_interest jsonb;
  v_service_id uuid;
  v_service_name text;
  v_label text;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'CRM_IDEMPOTENCY_REQUIRED' using errcode = '23514';
  end if;

  perform 1 from public.contacts c
  where c.id = p_contact_id and c.user_id = v_user_id
  for update;
  if not found then
    raise exception 'CRM_CONTACT_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_idempotency_key::text, 0));

  select d.id into v_deal_id
  from public.deals d
  where d.user_id = v_user_id and d.idempotency_key = p_idempotency_key;
  if v_deal_id is not null then
    return jsonb_build_object('contact_id', p_contact_id, 'deal_id', v_deal_id, 'reused', true);
  end if;

  insert into public.deals (user_id, contact_id, title, value, stage, expected_close, idempotency_key)
  values (
    v_user_id,
    p_contact_id,
    coalesce(nullif(btrim(p_title), ''), 'Nova oportunidade'),
    p_value,
    'new',
    p_expected_close,
    p_idempotency_key
  )
  returning id into v_deal_id;

  if jsonb_typeof(coalesce(p_interests, '[]'::jsonb)) <> 'array' then
    raise exception 'CRM_INTERESTS_INVALID' using errcode = '22023';
  end if;

  for v_interest in select value from jsonb_array_elements(coalesce(p_interests, '[]'::jsonb))
  loop
    v_service_id := nullif(v_interest->>'service_id', '')::uuid;
    v_label := nullif(btrim(v_interest->>'label'), '');
    v_service_name := null;

    if v_service_id is not null then
      select s.name into v_service_name
      from public.services s
      where s.id = v_service_id and s.user_id = v_user_id;
      if v_service_name is null then
        raise exception 'CRM_SERVICE_NOT_FOUND' using errcode = '23503';
      end if;
    end if;

    if coalesce(v_label, v_service_name) is not null then
      insert into public.crm_deal_interests (user_id, deal_id, service_id, label_snapshot)
      values (v_user_id, v_deal_id, v_service_id, coalesce(v_label, v_service_name));
    end if;
  end loop;

  if nullif(btrim(p_note), '') is not null then
    insert into public.crm_activities (user_id, contact_id, deal_id, activity_type, note, actor_user_id)
    values (v_user_id, p_contact_id, v_deal_id, 'note', btrim(p_note), v_user_id);
  end if;

  return jsonb_build_object('contact_id', p_contact_id, 'deal_id', v_deal_id, 'reused', false);
end;
$$;

-- Creates/reuses a CRM contact for a patient, then creates an opportunity.
create or replace function public.create_crm_opportunity_for_patient_v1(
  p_patient_id uuid,
  p_title text,
  p_value numeric default null,
  p_expected_close date default null,
  p_interests jsonb default '[]'::jsonb,
  p_note text default null,
  p_idempotency_key uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_patient public.patients%rowtype;
  v_contact_id uuid;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select * into v_patient
  from public.patients p
  where p.id = p_patient_id and p.user_id = v_user_id
  for update;

  if not found then
    raise exception 'CRM_PATIENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  select c.id into v_contact_id
  from public.contacts c
  where c.user_id = v_user_id and c.patient_id = p_patient_id;

  if v_contact_id is null then
    insert into public.contacts (
      user_id, patient_id, name, phone, email, instagram, source
    ) values (
      v_user_id,
      p_patient_id,
      v_patient.name,
      v_patient.phone,
      v_patient.email,
      v_patient.instagram,
      'existing_patient'
    )
    returning id into v_contact_id;

    insert into public.crm_activities (
      user_id, contact_id, activity_type, note, metadata, actor_user_id
    ) values (
      v_user_id,
      v_contact_id,
      'patient_linked',
      'Contato criado a partir de paciente existente.',
      jsonb_build_object('patient_id', p_patient_id),
      v_user_id
    );
  end if;

  return public.create_crm_deal_v1(
    v_contact_id,
    p_title,
    p_value,
    p_expected_close,
    p_interests,
    p_note,
    p_idempotency_key
  );
end;
$$;

-- Candidate search only. Never links automatically.
create or replace function public.find_crm_patient_candidates_v1(p_contact_id uuid)
returns table (
  patient_id uuid,
  name text,
  phone text,
  email text,
  archived_at timestamptz,
  matched_by text[]
)
language sql
security invoker
set search_path = public, pg_temp
as $$
  with owned_contact as (
    select c.*
    from public.contacts c
    where c.id = p_contact_id
      and c.user_id = (select auth.uid())
  )
  select
    p.id,
    p.name,
    p.phone,
    p.email,
    p.archived_at,
    array_remove(array[
      case
        when nullif(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), '') is not null
         and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')
        then 'phone'
      end,
      case
        when nullif(lower(btrim(coalesce(c.email, ''))), '') is not null
         and lower(btrim(coalesce(c.email, ''))) = lower(btrim(coalesce(p.email, '')))
        then 'email'
      end
    ], null)::text[] as matched_by
  from owned_contact c
  join public.patients p
    on p.user_id = c.user_id
   and (
     (
       nullif(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), '') is not null
       and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')
     )
     or
     (
       nullif(lower(btrim(coalesce(c.email, ''))), '') is not null
       and lower(btrim(coalesce(c.email, ''))) = lower(btrim(coalesce(p.email, '')))
     )
   )
  order by (p.archived_at is null) desc, p.created_at desc
  limit 10;
$$;

-- Atomic and idempotent Contact -> Patient link/create. No blind matching.
create or replace function public.convert_crm_contact_to_patient_v1(
  p_contact_id uuid,
  p_existing_patient_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_contact public.contacts%rowtype;
  v_patient_id uuid;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select * into v_contact
  from public.contacts c
  where c.id = p_contact_id and c.user_id = v_user_id
  for update;

  if not found then
    raise exception 'CRM_CONTACT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_contact.patient_id is not null then
    return v_contact.patient_id;
  end if;

  if p_existing_patient_id is not null then
    select p.id into v_patient_id
    from public.patients p
    where p.id = p_existing_patient_id and p.user_id = v_user_id;

    if v_patient_id is null then
      raise exception 'CRM_PATIENT_NOT_FOUND' using errcode = 'P0002';
    end if;
  else
    insert into public.patients (user_id, name, phone, email, instagram)
    values (
      v_user_id,
      v_contact.name,
      v_contact.phone,
      v_contact.email,
      v_contact.instagram
    )
    returning id into v_patient_id;
  end if;

  update public.contacts
  set patient_id = v_patient_id
  where id = p_contact_id and user_id = v_user_id;

  insert into public.crm_activities (
    user_id, contact_id, activity_type, note, metadata, actor_user_id
  ) values (
    v_user_id,
    p_contact_id,
    'patient_linked',
    case when p_existing_patient_id is null then 'Contato convertido em paciente.' else 'Contato vinculado a paciente existente.' end,
    jsonb_build_object('patient_id', v_patient_id, 'created_patient', p_existing_patient_id is null),
    v_user_id
  );

  return v_patient_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Pipeline read model. SECURITY INVOKER preserves RLS from all base tables.
-- ---------------------------------------------------------------------------
drop view if exists public.crm_pipeline_v;
create view public.crm_pipeline_v
with (security_invoker = true)
as
select
  d.id as deal_id,
  d.user_id,
  d.contact_id,
  d.title,
  d.value as estimated_value,
  d.stage,
  d.expected_close,
  d.lost_reason,
  d.lost_reason_detail,
  d.won_at,
  d.lost_at,
  d.closed_at,
  d.created_at as deal_created_at,
  d.updated_at as deal_updated_at,
  c.patient_id,
  c.name as contact_name,
  c.phone,
  c.email,
  c.instagram,
  c.source,
  c.source_detail,
  c.archived_at as contact_archived_at,
  p.name as patient_name,
  coalesce(i.interests, '[]'::jsonb) as interests,
  f.next_followup_on,
  a.last_activity_at
from public.deals d
join public.contacts c
  on c.id = d.contact_id and c.user_id = d.user_id
left join public.patients p
  on p.id = c.patient_id and p.user_id = c.user_id
left join lateral (
  select jsonb_agg(
    jsonb_build_object(
      'id', x.id,
      'service_id', x.service_id,
      'label', x.label_snapshot
    )
    order by x.created_at, x.id
  ) as interests
  from public.crm_deal_interests x
  where x.user_id = d.user_id and x.deal_id = d.id
) i on true
left join lateral (
  select min(fu.due_on) as next_followup_on
  from public.crm_followups fu
  where fu.user_id = d.user_id
    and fu.deal_id = d.id
    and fu.status = 'open'
) f on true
left join lateral (
  select max(ac.occurred_at) as last_activity_at
  from public.crm_activities ac
  where ac.user_id = d.user_id
    and ac.deal_id = d.id
) a on true;

-- ---------------------------------------------------------------------------
-- Grants. Supabase no longer auto-exposes new tables: be explicit.
-- Anonymous receives zero CRM access.
-- ---------------------------------------------------------------------------
revoke all on public.crm_deal_interests from public, anon;
revoke all on public.crm_followups from public, anon;
revoke all on public.crm_activities from public, anon;
revoke all on public.crm_pipeline_v from public, anon;

grant select, insert, update, delete on public.crm_deal_interests to authenticated;
grant select, insert, update on public.crm_followups to authenticated;
grant select, insert on public.crm_activities to authenticated;
grant select on public.crm_pipeline_v to authenticated;

-- Common UI never hard-deletes contacts/deals. Closed/archived history is retained.
revoke delete on public.contacts from authenticated;
revoke delete on public.deals from authenticated;

-- Existing tables are explicitly unavailable to anon as part of the CRM boundary.
revoke all on public.contacts from anon;
revoke all on public.deals from anon;

revoke all on function public.crm_touch_updated_at_v2() from public, anon;
revoke all on function public.crm_prepare_deal_v2() from public, anon;
revoke all on function public.crm_log_stage_change_v2() from public, anon;
revoke all on function public.crm_prepare_followup_v2() from public, anon;
revoke all on function public.crm_log_followup_activity_v2() from public, anon;
revoke all on function public.create_crm_lead_v1(text,text,text,text,text,text,text,numeric,date,jsonb,text,uuid) from public, anon;
revoke all on function public.create_crm_deal_v1(uuid,text,numeric,date,jsonb,text,uuid) from public, anon;
revoke all on function public.create_crm_opportunity_for_patient_v1(uuid,text,numeric,date,jsonb,text,uuid) from public, anon;
revoke all on function public.find_crm_patient_candidates_v1(uuid) from public, anon;
revoke all on function public.convert_crm_contact_to_patient_v1(uuid,uuid) from public, anon;

grant execute on function public.create_crm_lead_v1(text,text,text,text,text,text,text,numeric,date,jsonb,text,uuid) to authenticated;
grant execute on function public.create_crm_deal_v1(uuid,text,numeric,date,jsonb,text,uuid) to authenticated;
grant execute on function public.create_crm_opportunity_for_patient_v1(uuid,text,numeric,date,jsonb,text,uuid) to authenticated;
grant execute on function public.find_crm_patient_candidates_v1(uuid) to authenticated;
grant execute on function public.convert_crm_contact_to_patient_v1(uuid,uuid) to authenticated;

-- Trigger helpers are not API RPCs.
revoke execute on function public.crm_touch_updated_at_v2() from authenticated;
revoke execute on function public.crm_prepare_deal_v2() from authenticated;
revoke execute on function public.crm_log_stage_change_v2() from authenticated;
revoke execute on function public.crm_prepare_followup_v2() from authenticated;
revoke execute on function public.crm_log_followup_activity_v2() from authenticated;

comment on column public.deals.value is 'CRM estimated opportunity value. Not an official quote or procedure total.';
comment on column public.crm_followups.due_on is 'Commercial follow-up day in clinic local calendar semantics (America/Sao_Paulo).';
comment on view public.crm_pipeline_v is 'CRM 2.0 pipeline read model; security_invoker delegates access control to base-table RLS.';
