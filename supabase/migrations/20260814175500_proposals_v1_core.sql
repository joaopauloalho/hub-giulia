begin;

create table public.treatment_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  deal_id uuid not null,
  name text not null,
  idempotency_key uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint treatment_proposals_name_check check (nullif(btrim(name), '') is not null),
  constraint treatment_proposals_deal_owner_fkey foreign key (deal_id, user_id)
    references public.deals(id, user_id)
);

create unique index treatment_proposals_id_user_id_uidx
  on public.treatment_proposals(id, user_id);
create unique index treatment_proposals_user_idempotency_uidx
  on public.treatment_proposals(user_id, idempotency_key)
  where idempotency_key is not null;
create index treatment_proposals_user_deal_created_idx
  on public.treatment_proposals(user_id, deal_id, created_at desc);

create table public.treatment_proposal_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  proposal_id uuid not null,
  version_number integer not null,
  status text not null default 'draft',
  title text not null,
  draft_revision bigint not null default 0,
  currency text not null default 'BRL',
  recipient_snapshot jsonb,
  professional_snapshot jsonb,
  payment_terms text,
  internal_note text,
  customer_note text,
  subtotal numeric(14,2) not null default 0,
  item_discount_amount numeric(14,2) not null default 0,
  net_subtotal numeric(14,2) not null default 0,
  discount_type text not null default 'none',
  discount_value numeric(14,4) not null default 0,
  discount_amount numeric(14,2) not null default 0,
  total_value numeric(14,2) not null default 0,
  valid_until date,
  issued_at timestamptz,
  sent_at timestamptz,
  accepted_at timestamptz,
  declined_at timestamptz,
  voided_at timestamptz,
  decline_reason text,
  void_reason text,
  supersedes_version_id uuid,
  issue_idempotency_key uuid,
  revision_idempotency_key uuid,
  sent_idempotency_key uuid,
  accept_idempotency_key uuid,
  decline_idempotency_key uuid,
  void_idempotency_key uuid,
  pdf_path text,
  pdf_sha256 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint treatment_proposal_versions_proposal_owner_fkey foreign key (proposal_id, user_id)
    references public.treatment_proposals(id, user_id) on delete cascade,
  constraint treatment_proposal_versions_status_check check (status in ('draft','issued','accepted','declined','voided')),
  constraint treatment_proposal_versions_version_number_check check (version_number > 0),
  constraint treatment_proposal_versions_currency_check check (currency = 'BRL'),
  constraint treatment_proposal_versions_title_check check (nullif(btrim(title), '') is not null),
  constraint treatment_proposal_versions_discount_type_check check (discount_type in ('none','amount','percent')),
  constraint treatment_proposal_versions_discount_value_check check (discount_value >= 0 and (discount_type <> 'percent' or discount_value <= 100)),
  constraint treatment_proposal_versions_money_check check (
    subtotal >= 0 and item_discount_amount >= 0 and net_subtotal >= 0 and
    discount_amount >= 0 and total_value >= 0 and
    item_discount_amount <= subtotal and discount_amount <= net_subtotal and
    net_subtotal = subtotal - item_discount_amount and total_value = net_subtotal - discount_amount
  ),
  constraint treatment_proposal_versions_status_timestamp_check check (
    (status <> 'accepted' or accepted_at is not null) and
    (status <> 'declined' or declined_at is not null) and
    (status <> 'voided' or voided_at is not null) and
    (status = 'draft' or issued_at is not null)
  ),
  constraint treatment_proposal_versions_pdf_sha_check check (pdf_sha256 is null or pdf_sha256 ~ '^[0-9a-f]{64}$')
);

create unique index treatment_proposal_versions_id_user_id_uidx
  on public.treatment_proposal_versions(id, user_id);
create unique index treatment_proposal_versions_proposal_number_uidx
  on public.treatment_proposal_versions(proposal_id, version_number);
create unique index treatment_proposal_versions_one_draft_uidx
  on public.treatment_proposal_versions(proposal_id)
  where status = 'draft';
create unique index treatment_proposal_versions_one_accepted_uidx
  on public.treatment_proposal_versions(proposal_id)
  where status = 'accepted';
create unique index treatment_proposal_versions_issue_key_uidx
  on public.treatment_proposal_versions(user_id, issue_idempotency_key)
  where issue_idempotency_key is not null;
create unique index treatment_proposal_versions_revision_key_uidx
  on public.treatment_proposal_versions(user_id, revision_idempotency_key)
  where revision_idempotency_key is not null;
create unique index treatment_proposal_versions_accept_key_uidx
  on public.treatment_proposal_versions(user_id, accept_idempotency_key)
  where accept_idempotency_key is not null;
create index treatment_proposal_versions_proposal_created_idx
  on public.treatment_proposal_versions(proposal_id, version_number desc);
create index treatment_proposal_versions_user_status_valid_idx
  on public.treatment_proposal_versions(user_id, status, valid_until);

alter table public.treatment_proposal_versions
  add constraint treatment_proposal_versions_supersedes_owner_fkey
  foreign key (supersedes_version_id, user_id)
  references public.treatment_proposal_versions(id, user_id);

create table public.treatment_proposal_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  proposal_version_id uuid not null,
  service_id uuid,
  service_name_snapshot text not null,
  description_snapshot text,
  interval_note text,
  quantity numeric(12,3) not null default 1,
  unit_label text not null default 'sessão',
  list_unit_price_snapshot numeric(14,2) not null default 0,
  offered_unit_price numeric(14,2) not null default 0,
  discount_type text not null default 'none',
  discount_value numeric(14,4) not null default 0,
  discount_amount numeric(14,2) not null default 0,
  line_subtotal numeric(14,2) not null default 0,
  line_total numeric(14,2) not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint treatment_proposal_items_version_owner_fkey foreign key (proposal_version_id, user_id)
    references public.treatment_proposal_versions(id, user_id) on delete cascade,
  constraint treatment_proposal_items_service_owner_fkey foreign key (service_id, user_id)
    references public.services(id, user_id) on delete set null (service_id),
  constraint treatment_proposal_items_name_check check (nullif(btrim(service_name_snapshot), '') is not null),
  constraint treatment_proposal_items_quantity_check check (quantity > 0),
  constraint treatment_proposal_items_unit_check check (nullif(btrim(unit_label), '') is not null),
  constraint treatment_proposal_items_prices_check check (list_unit_price_snapshot >= 0 and offered_unit_price >= 0),
  constraint treatment_proposal_items_discount_type_check check (discount_type in ('none','amount','percent')),
  constraint treatment_proposal_items_discount_value_check check (discount_value >= 0 and (discount_type <> 'percent' or discount_value <= 100)),
  constraint treatment_proposal_items_money_check check (
    line_subtotal >= 0 and discount_amount >= 0 and line_total >= 0 and
    discount_amount <= line_subtotal and line_total = line_subtotal - discount_amount
  )
);

create unique index treatment_proposal_items_id_user_id_uidx
  on public.treatment_proposal_items(id, user_id);
create index treatment_proposal_items_version_sort_idx
  on public.treatment_proposal_items(proposal_version_id, sort_order, id);
create index treatment_proposal_items_service_user_idx
  on public.treatment_proposal_items(service_id, user_id)
  where service_id is not null;

create or replace function public.proposal_discount_amount_v1(
  p_base numeric,
  p_type text,
  p_value numeric
) returns numeric
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_base numeric := round(coalesce(p_base, 0), 2);
  v_value numeric := coalesce(p_value, 0);
begin
  if v_base < 0 then raise exception 'PROPOSAL_NEGATIVE_BASE'; end if;
  if p_type = 'none' then
    if v_value <> 0 then raise exception 'PROPOSAL_NONE_DISCOUNT_VALUE'; end if;
    return 0;
  elsif p_type = 'amount' then
    v_value := round(v_value, 2);
    if v_value < 0 or v_value > v_base then raise exception 'PROPOSAL_INVALID_AMOUNT_DISCOUNT'; end if;
    return v_value;
  elsif p_type = 'percent' then
    if v_value < 0 or v_value > 100 then raise exception 'PROPOSAL_INVALID_PERCENT_DISCOUNT'; end if;
    return round(v_base * v_value / 100, 2);
  end if;
  raise exception 'PROPOSAL_INVALID_DISCOUNT_TYPE';
end;
$$;

create or replace function public.proposal_item_calculate_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  select status into v_status
  from public.treatment_proposal_versions
  where id = new.proposal_version_id and user_id = new.user_id;
  if v_status is distinct from 'draft' then raise exception 'PROPOSAL_VERSION_IMMUTABLE'; end if;

  new.service_name_snapshot := btrim(new.service_name_snapshot);
  new.unit_label := btrim(new.unit_label);
  new.quantity := round(new.quantity, 3);
  new.list_unit_price_snapshot := round(new.list_unit_price_snapshot, 2);
  new.offered_unit_price := round(new.offered_unit_price, 2);
  new.discount_value := case when new.discount_type = 'amount' then round(new.discount_value, 2) else new.discount_value end;
  new.line_subtotal := round(new.quantity * new.offered_unit_price, 2);
  new.discount_amount := public.proposal_discount_amount_v1(new.line_subtotal, new.discount_type, new.discount_value);
  new.line_total := new.line_subtotal - new.discount_amount;
  new.updated_at := now();
  return new;
end;
$$;

create trigger treatment_proposal_items_calculate_biu
before insert or update on public.treatment_proposal_items
for each row execute function public.proposal_item_calculate_v1();

create or replace function public.proposal_recalculate_version_v1(p_version_id uuid)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_subtotal numeric(14,2);
  v_item_discount numeric(14,2);
  v_net numeric(14,2);
  v_type text;
  v_value numeric;
  v_global numeric(14,2);
begin
  select discount_type, discount_value into v_type, v_value
  from public.treatment_proposal_versions
  where id = p_version_id and status = 'draft'
  for update;
  if not found then return; end if;

  select coalesce(sum(line_subtotal),0), coalesce(sum(discount_amount),0), coalesce(sum(line_total),0)
    into v_subtotal, v_item_discount, v_net
  from public.treatment_proposal_items
  where proposal_version_id = p_version_id;

  v_global := public.proposal_discount_amount_v1(v_net, v_type, v_value);
  update public.treatment_proposal_versions
  set subtotal = round(v_subtotal,2),
      item_discount_amount = round(v_item_discount,2),
      net_subtotal = round(v_net,2),
      discount_amount = v_global,
      total_value = round(v_net - v_global,2),
      updated_at = now()
  where id = p_version_id;
end;
$$;

create or replace function public.proposal_item_recalculate_parent_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if current_setting('app.proposal_skip_recalc', true) = 'on' then return coalesce(new, old); end if;
  v_id := coalesce(new.proposal_version_id, old.proposal_version_id);
  perform public.proposal_recalculate_version_v1(v_id);
  return coalesce(new, old);
end;
$$;

create trigger treatment_proposal_items_recalculate_aiud
after insert or update or delete on public.treatment_proposal_items
for each row execute function public.proposal_item_recalculate_parent_v1();

create or replace function public.proposal_version_immutability_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.status <> 'draft' then
    if new.user_id is distinct from old.user_id
      or new.proposal_id is distinct from old.proposal_id
      or new.version_number is distinct from old.version_number
      or new.title is distinct from old.title
      or new.draft_revision is distinct from old.draft_revision
      or new.currency is distinct from old.currency
      or new.recipient_snapshot is distinct from old.recipient_snapshot
      or new.professional_snapshot is distinct from old.professional_snapshot
      or new.payment_terms is distinct from old.payment_terms
      or new.internal_note is distinct from old.internal_note
      or new.customer_note is distinct from old.customer_note
      or new.subtotal is distinct from old.subtotal
      or new.item_discount_amount is distinct from old.item_discount_amount
      or new.net_subtotal is distinct from old.net_subtotal
      or new.discount_type is distinct from old.discount_type
      or new.discount_value is distinct from old.discount_value
      or new.discount_amount is distinct from old.discount_amount
      or new.total_value is distinct from old.total_value
      or new.valid_until is distinct from old.valid_until
      or new.supersedes_version_id is distinct from old.supersedes_version_id
      or new.created_at is distinct from old.created_at
    then
      raise exception 'PROPOSAL_VERSION_IMMUTABLE';
    end if;

    if old.status = 'accepted' and new.status <> 'accepted' then raise exception 'PROPOSAL_ACCEPTED_IMMUTABLE'; end if;
    if old.status = 'declined' and new.status <> 'declined' then raise exception 'PROPOSAL_DECLINED_IMMUTABLE'; end if;
    if old.status = 'voided' and new.status <> 'voided' then raise exception 'PROPOSAL_VOIDED_IMMUTABLE'; end if;
    if old.status = 'issued' and new.status not in ('issued','accepted','declined','voided') then raise exception 'PROPOSAL_INVALID_STATUS_TRANSITION'; end if;
    if old.pdf_path is not null and new.pdf_path is distinct from old.pdf_path then raise exception 'PROPOSAL_PDF_IMMUTABLE'; end if;
    if old.pdf_sha256 is not null and new.pdf_sha256 is distinct from old.pdf_sha256 then raise exception 'PROPOSAL_PDF_IMMUTABLE'; end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger treatment_proposal_versions_immutability_bu
before update on public.treatment_proposal_versions
for each row execute function public.proposal_version_immutability_v1();

create or replace function public.create_treatment_proposal_v1(
  p_deal_id uuid,
  p_title text,
  p_idempotency_key uuid
) returns table(proposal_id uuid, version_id uuid, version_number integer, draft_revision bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_proposal public.treatment_proposals%rowtype;
  v_version public.treatment_proposal_versions%rowtype;
  v_contact_id uuid;
  v_title text := nullif(btrim(p_title), '');
begin
  if v_uid is null then raise exception 'PROPOSAL_SESSION_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception 'PROPOSAL_IDEMPOTENCY_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || p_idempotency_key::text, 0));

  select * into v_proposal from public.treatment_proposals
  where user_id = v_uid and idempotency_key = p_idempotency_key;
  if found then
    select * into v_version from public.treatment_proposal_versions
    where proposal_id = v_proposal.id order by version_number desc limit 1;
    return query select v_proposal.id, v_version.id, v_version.version_number, v_version.draft_revision;
    return;
  end if;

  select d.contact_id, coalesce(v_title, d.title) into v_contact_id, v_title
  from public.deals d where d.id = p_deal_id and d.user_id = v_uid;
  if not found then raise exception 'PROPOSAL_DEAL_NOT_FOUND'; end if;
  if nullif(btrim(v_title), '') is null then raise exception 'PROPOSAL_TITLE_REQUIRED'; end if;

  insert into public.treatment_proposals(user_id, deal_id, name, idempotency_key)
  values(v_uid, p_deal_id, v_title, p_idempotency_key)
  returning * into v_proposal;

  insert into public.treatment_proposal_versions(user_id, proposal_id, version_number, status, title)
  values(v_uid, v_proposal.id, 1, 'draft', v_title)
  returning * into v_version;

  insert into public.crm_activities(user_id, contact_id, deal_id, activity_type, note, metadata, actor_user_id)
  values(v_uid, v_contact_id, p_deal_id, 'proposal_created', 'Proposta criada', jsonb_build_object('proposal_id',v_proposal.id,'version_id',v_version.id,'version_number',1), v_uid);

  return query select v_proposal.id, v_version.id, 1, v_version.draft_revision;
end;
$$;

create or replace function public.save_treatment_proposal_draft_v1(
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
    v_unit := coalesce(nullif(btrim(v_item->>'unit_label'),''),'sessão');
    insert into public.treatment_proposal_items(
      user_id, proposal_version_id, service_id, service_name_snapshot, description_snapshot, interval_note,
      quantity, unit_label, list_unit_price_snapshot, offered_unit_price, discount_type, discount_value, sort_order
    ) values(
      v_uid,p_version_id,v_service,v_name,nullif(btrim(v_item->>'description_snapshot'),''),nullif(btrim(v_item->>'interval_note'),''),
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

create or replace function public.issue_treatment_proposal_v1(
  p_version_id uuid,
  p_expected_revision bigint,
  p_idempotency_key uuid
) returns table(version_id uuid, status text, issued_at timestamptz, total_value numeric, valid_until date)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_version public.treatment_proposal_versions%rowtype;
  v_deal uuid;
  v_contact uuid;
  v_recipient jsonb;
  v_professional jsonb;
  v_count integer;
begin
  if v_uid is null then raise exception 'PROPOSAL_SESSION_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception 'PROPOSAL_IDEMPOTENCY_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':issue:' || p_idempotency_key::text,0));

  select * into v_version from public.treatment_proposal_versions where id=p_version_id and user_id=v_uid for update;
  if not found then raise exception 'PROPOSAL_VERSION_NOT_FOUND'; end if;
  if v_version.status <> 'draft' then
    if v_version.issue_idempotency_key = p_idempotency_key then
      return query select v_version.id,v_version.status,v_version.issued_at,v_version.total_value,v_version.valid_until; return;
    end if;
    raise exception 'PROPOSAL_VERSION_IMMUTABLE';
  end if;
  if v_version.draft_revision <> coalesce(p_expected_revision,-1) then raise exception 'PROPOSAL_DRAFT_CONFLICT'; end if;
  if v_version.valid_until is null then raise exception 'PROPOSAL_VALIDITY_REQUIRED'; end if;
  if v_version.valid_until < (now() at time zone 'America/Sao_Paulo')::date then raise exception 'PROPOSAL_VALIDITY_EXPIRED'; end if;
  select count(*) into v_count from public.treatment_proposal_items where proposal_version_id=p_version_id and user_id=v_uid;
  if v_count < 1 then raise exception 'PROPOSAL_ITEMS_REQUIRED'; end if;
  if exists(select 1 from public.treatment_proposal_items where proposal_version_id=p_version_id and (nullif(btrim(service_name_snapshot),'') is null or quantity<=0 or line_total<0)) then raise exception 'PROPOSAL_ITEMS_INVALID'; end if;

  perform public.proposal_recalculate_version_v1(p_version_id);
  select * into v_version from public.treatment_proposal_versions where id=p_version_id;

  select p.deal_id,d.contact_id,jsonb_build_object('name',c.name)
    into v_deal,v_contact,v_recipient
  from public.treatment_proposals p
  join public.deals d on d.id=p.deal_id and d.user_id=p.user_id
  join public.contacts c on c.id=d.contact_id and c.user_id=d.user_id
  where p.id=v_version.proposal_id and p.user_id=v_uid;
  if v_recipient is null or nullif(btrim(v_recipient->>'name'),'') is null then raise exception 'PROPOSAL_RECIPIENT_REQUIRED'; end if;

  select jsonb_build_object('display_name',pp.display_name,'profession',pp.profession,'professional_registration',pp.professional_registration)
    into v_professional from public.professional_profiles pp where pp.user_id=v_uid;

  update public.treatment_proposal_versions
  set status='issued',recipient_snapshot=v_recipient,professional_snapshot=v_professional,
      issued_at=now(),issue_idempotency_key=p_idempotency_key,updated_at=now()
  where id=p_version_id returning * into v_version;

  insert into public.crm_activities(user_id,contact_id,deal_id,activity_type,note,metadata,actor_user_id)
  values(v_uid,v_contact,v_deal,'proposal_issued','Proposta emitida',jsonb_build_object('proposal_id',v_version.proposal_id,'version_id',v_version.id,'version_number',v_version.version_number,'total_value',v_version.total_value),v_uid);

  return query select v_version.id,v_version.status,v_version.issued_at,v_version.total_value,v_version.valid_until;
end;
$$;

create or replace function public.create_treatment_proposal_revision_v1(
  p_source_version_id uuid,
  p_idempotency_key uuid
) returns table(proposal_id uuid, version_id uuid, version_number integer, draft_revision bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_source public.treatment_proposal_versions%rowtype;
  v_new public.treatment_proposal_versions%rowtype;
  v_deal uuid;
  v_contact uuid;
  v_next integer;
begin
  if v_uid is null then raise exception 'PROPOSAL_SESSION_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception 'PROPOSAL_IDEMPOTENCY_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':revision:' || p_idempotency_key::text,0));
  select * into v_new from public.treatment_proposal_versions where user_id=v_uid and revision_idempotency_key=p_idempotency_key;
  if found then return query select v_new.proposal_id,v_new.id,v_new.version_number,v_new.draft_revision; return; end if;

  select * into v_source from public.treatment_proposal_versions where id=p_source_version_id and user_id=v_uid for share;
  if not found then raise exception 'PROPOSAL_VERSION_NOT_FOUND'; end if;
  if v_source.status = 'draft' then raise exception 'PROPOSAL_SOURCE_IS_DRAFT'; end if;
  if v_source.status = 'accepted' then raise exception 'PROPOSAL_ACCEPTED_IMMUTABLE'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_source.proposal_id::text,0));
  if exists(select 1 from public.treatment_proposal_versions where proposal_id=v_source.proposal_id and status='draft') then raise exception 'PROPOSAL_DRAFT_ALREADY_EXISTS'; end if;
  select coalesce(max(version_number),0)+1 into v_next from public.treatment_proposal_versions where proposal_id=v_source.proposal_id;

  insert into public.treatment_proposal_versions(
    user_id,proposal_id,version_number,status,title,currency,payment_terms,internal_note,customer_note,
    discount_type,discount_value,valid_until,supersedes_version_id,revision_idempotency_key
  ) values(
    v_uid,v_source.proposal_id,v_next,'draft',v_source.title,v_source.currency,v_source.payment_terms,v_source.internal_note,v_source.customer_note,
    v_source.discount_type,v_source.discount_value,v_source.valid_until,v_source.id,p_idempotency_key
  ) returning * into v_new;

  perform set_config('app.proposal_skip_recalc','on',true);
  insert into public.treatment_proposal_items(
    user_id,proposal_version_id,service_id,service_name_snapshot,description_snapshot,interval_note,quantity,unit_label,
    list_unit_price_snapshot,offered_unit_price,discount_type,discount_value,sort_order
  )
  select user_id,v_new.id,service_id,service_name_snapshot,description_snapshot,interval_note,quantity,unit_label,
         list_unit_price_snapshot,offered_unit_price,discount_type,discount_value,sort_order
  from public.treatment_proposal_items where proposal_version_id=v_source.id order by sort_order,id;
  perform set_config('app.proposal_skip_recalc','off',true);
  perform public.proposal_recalculate_version_v1(v_new.id);
  select * into v_new from public.treatment_proposal_versions where id=v_new.id;

  select p.deal_id,d.contact_id into v_deal,v_contact from public.treatment_proposals p join public.deals d on d.id=p.deal_id and d.user_id=p.user_id where p.id=v_new.proposal_id;
  insert into public.crm_activities(user_id,contact_id,deal_id,activity_type,note,metadata,actor_user_id)
  values(v_uid,v_contact,v_deal,'proposal_revised','Nova versão da proposta criada',jsonb_build_object('proposal_id',v_new.proposal_id,'source_version_id',v_source.id,'version_id',v_new.id,'version_number',v_new.version_number),v_uid);

  return query select v_new.proposal_id,v_new.id,v_new.version_number,v_new.draft_revision;
end;
$$;

create or replace function public.mark_treatment_proposal_sent_v1(
  p_version_id uuid,
  p_idempotency_key uuid
) returns table(version_id uuid, sent_at timestamptz, deal_stage text, deal_value numeric)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid:=auth.uid();
  v_version public.treatment_proposal_versions%rowtype;
  v_deal public.deals%rowtype;
  v_contact uuid;
  v_from text;
begin
  if v_uid is null then raise exception 'PROPOSAL_SESSION_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception 'PROPOSAL_IDEMPOTENCY_REQUIRED'; end if;
  select * into v_version from public.treatment_proposal_versions where id=p_version_id and user_id=v_uid for update;
  if not found then raise exception 'PROPOSAL_VERSION_NOT_FOUND'; end if;
  if v_version.status <> 'issued' then raise exception 'PROPOSAL_NOT_ISSUED'; end if;
  select d.* into v_deal from public.treatment_proposals p join public.deals d on d.id=p.deal_id and d.user_id=p.user_id where p.id=v_version.proposal_id for update;
  v_contact:=v_deal.contact_id; v_from:=v_deal.stage;
  if v_version.sent_at is null then
    update public.treatment_proposal_versions set sent_at=now(),sent_idempotency_key=p_idempotency_key where id=p_version_id returning * into v_version;
    update public.deals set value=v_version.total_value,
      stage=case when stage in ('new','contacted','assessment_scheduled') then 'proposal_sent' else stage end,
      updated_at=now()
    where id=v_deal.id and user_id=v_uid returning * into v_deal;
    insert into public.crm_activities(user_id,contact_id,deal_id,activity_type,note,from_stage,to_stage,metadata,actor_user_id)
    values(v_uid,v_contact,v_deal.id,'proposal_sent','Proposta marcada como enviada',v_from,v_deal.stage,jsonb_build_object('proposal_id',v_version.proposal_id,'version_id',v_version.id,'version_number',v_version.version_number,'total_value',v_version.total_value),v_uid);
  end if;
  return query select v_version.id,v_version.sent_at,v_deal.stage,v_deal.value;
end;
$$;

create or replace function public.accept_treatment_proposal_v1(
  p_version_id uuid,
  p_mark_deal_won boolean,
  p_idempotency_key uuid
) returns table(version_id uuid, status text, accepted_at timestamptz, deal_stage text, deal_value numeric)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid:=auth.uid();
  v_version public.treatment_proposal_versions%rowtype;
  v_deal public.deals%rowtype;
  v_contact uuid;
  v_from text;
begin
  if v_uid is null then raise exception 'PROPOSAL_SESSION_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception 'PROPOSAL_IDEMPOTENCY_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':accept:' || p_idempotency_key::text,0));
  select * into v_version from public.treatment_proposal_versions where id=p_version_id and user_id=v_uid for update;
  if not found then raise exception 'PROPOSAL_VERSION_NOT_FOUND'; end if;
  if v_version.status='accepted' and v_version.accept_idempotency_key=p_idempotency_key then
    select d.* into v_deal from public.treatment_proposals p join public.deals d on d.id=p.deal_id and d.user_id=p.user_id where p.id=v_version.proposal_id;
    return query select v_version.id,v_version.status,v_version.accepted_at,v_deal.stage,v_deal.value; return;
  end if;
  if v_version.status <> 'issued' then raise exception 'PROPOSAL_NOT_ISSUED'; end if;
  if v_version.valid_until < (now() at time zone 'America/Sao_Paulo')::date then raise exception 'PROPOSAL_EXPIRED_CREATE_REVISION'; end if;
  if exists(select 1 from public.treatment_proposal_versions where proposal_id=v_version.proposal_id and status='accepted' and id<>v_version.id) then raise exception 'PROPOSAL_ALREADY_ACCEPTED'; end if;
  select d.* into v_deal from public.treatment_proposals p join public.deals d on d.id=p.deal_id and d.user_id=p.user_id where p.id=v_version.proposal_id for update;
  if coalesce(p_mark_deal_won,false) and v_deal.stage='lost' then raise exception 'PROPOSAL_DEAL_LOST_REOPEN_FIRST'; end if;
  v_contact:=v_deal.contact_id; v_from:=v_deal.stage;
  update public.treatment_proposal_versions set status='accepted',accepted_at=now(),accept_idempotency_key=p_idempotency_key where id=v_version.id returning * into v_version;
  update public.deals set value=v_version.total_value,
      stage=case when coalesce(p_mark_deal_won,false) then 'won' else stage end,
      won_at=case when coalesce(p_mark_deal_won,false) then coalesce(won_at,now()) else won_at end,
      closed_at=case when coalesce(p_mark_deal_won,false) then coalesce(closed_at,now()) else closed_at end,
      updated_at=now()
  where id=v_deal.id and user_id=v_uid returning * into v_deal;
  insert into public.crm_activities(user_id,contact_id,deal_id,activity_type,note,from_stage,to_stage,metadata,actor_user_id)
  values(v_uid,v_contact,v_deal.id,'proposal_accepted',case when coalesce(p_mark_deal_won,false) then 'Proposta aceita e oportunidade ganha' else 'Proposta aceita' end,v_from,v_deal.stage,jsonb_build_object('proposal_id',v_version.proposal_id,'version_id',v_version.id,'version_number',v_version.version_number,'total_value',v_version.total_value,'deal_won',coalesce(p_mark_deal_won,false)),v_uid);
  return query select v_version.id,v_version.status,v_version.accepted_at,v_deal.stage,v_deal.value;
end;
$$;

create or replace function public.decline_treatment_proposal_v1(
  p_version_id uuid,
  p_reason text,
  p_idempotency_key uuid
) returns table(version_id uuid, status text, declined_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid:=auth.uid(); v_version public.treatment_proposal_versions%rowtype; v_deal uuid; v_contact uuid;
begin
  if v_uid is null then raise exception 'PROPOSAL_SESSION_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception 'PROPOSAL_IDEMPOTENCY_REQUIRED'; end if;
  select * into v_version from public.treatment_proposal_versions where id=p_version_id and user_id=v_uid for update;
  if not found then raise exception 'PROPOSAL_VERSION_NOT_FOUND'; end if;
  if v_version.status='declined' and v_version.decline_idempotency_key=p_idempotency_key then return query select v_version.id,v_version.status,v_version.declined_at; return; end if;
  if v_version.status <> 'issued' then raise exception 'PROPOSAL_NOT_ISSUED'; end if;
  update public.treatment_proposal_versions set status='declined',declined_at=now(),decline_reason=nullif(btrim(p_reason),''),decline_idempotency_key=p_idempotency_key where id=p_version_id returning * into v_version;
  select p.deal_id,d.contact_id into v_deal,v_contact from public.treatment_proposals p join public.deals d on d.id=p.deal_id and d.user_id=p.user_id where p.id=v_version.proposal_id;
  insert into public.crm_activities(user_id,contact_id,deal_id,activity_type,note,metadata,actor_user_id)
  values(v_uid,v_contact,v_deal,'proposal_declined','Proposta recusada',jsonb_build_object('proposal_id',v_version.proposal_id,'version_id',v_version.id,'version_number',v_version.version_number,'reason',v_version.decline_reason),v_uid);
  return query select v_version.id,v_version.status,v_version.declined_at;
end;
$$;

create or replace function public.void_treatment_proposal_v1(
  p_version_id uuid,
  p_reason text,
  p_idempotency_key uuid
) returns table(version_id uuid, status text, voided_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid:=auth.uid(); v_version public.treatment_proposal_versions%rowtype; v_deal uuid; v_contact uuid;
begin
  if v_uid is null then raise exception 'PROPOSAL_SESSION_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception 'PROPOSAL_IDEMPOTENCY_REQUIRED'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'PROPOSAL_VOID_REASON_REQUIRED'; end if;
  select * into v_version from public.treatment_proposal_versions where id=p_version_id and user_id=v_uid for update;
  if not found then raise exception 'PROPOSAL_VERSION_NOT_FOUND'; end if;
  if v_version.status='voided' and v_version.void_idempotency_key=p_idempotency_key then return query select v_version.id,v_version.status,v_version.voided_at; return; end if;
  if v_version.status <> 'issued' then raise exception 'PROPOSAL_ONLY_ISSUED_CAN_VOID'; end if;
  update public.treatment_proposal_versions set status='voided',voided_at=now(),void_reason=btrim(p_reason),void_idempotency_key=p_idempotency_key where id=p_version_id returning * into v_version;
  select p.deal_id,d.contact_id into v_deal,v_contact from public.treatment_proposals p join public.deals d on d.id=p.deal_id and d.user_id=p.user_id where p.id=v_version.proposal_id;
  insert into public.crm_activities(user_id,contact_id,deal_id,activity_type,note,metadata,actor_user_id)
  values(v_uid,v_contact,v_deal,'proposal_voided','Proposta anulada',jsonb_build_object('proposal_id',v_version.proposal_id,'version_id',v_version.id,'version_number',v_version.version_number,'reason',v_version.void_reason),v_uid);
  return query select v_version.id,v_version.status,v_version.voided_at;
end;
$$;

create or replace function public.attach_treatment_proposal_pdf_v1(
  p_version_id uuid,
  p_pdf_path text,
  p_pdf_sha256 text
) returns table(version_id uuid, pdf_path text, pdf_sha256 text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid:=auth.uid(); v_version public.treatment_proposal_versions%rowtype; v_expected text;
begin
  if v_uid is null then raise exception 'PROPOSAL_SESSION_REQUIRED'; end if;
  select * into v_version from public.treatment_proposal_versions where id=p_version_id and user_id=v_uid for update;
  if not found then raise exception 'PROPOSAL_VERSION_NOT_FOUND'; end if;
  if v_version.status='draft' then raise exception 'PROPOSAL_NOT_ISSUED'; end if;
  v_expected := v_uid::text || '/' || v_version.proposal_id::text || '/' || v_version.id::text || '/proposal.pdf';
  if p_pdf_path is distinct from v_expected then raise exception 'PROPOSAL_INVALID_PDF_PATH'; end if;
  if lower(coalesce(p_pdf_sha256,'')) !~ '^[0-9a-f]{64}$' then raise exception 'PROPOSAL_INVALID_PDF_SHA256'; end if;
  if v_version.pdf_path is not null then
    if v_version.pdf_path=p_pdf_path and v_version.pdf_sha256=lower(p_pdf_sha256) then return query select v_version.id,v_version.pdf_path,v_version.pdf_sha256; return; end if;
    raise exception 'PROPOSAL_PDF_IMMUTABLE';
  end if;
  update public.treatment_proposal_versions set pdf_path=p_pdf_path,pdf_sha256=lower(p_pdf_sha256) where id=p_version_id returning * into v_version;
  return query select v_version.id,v_version.pdf_path,v_version.pdf_sha256;
end;
$$;

revoke all on function public.proposal_discount_amount_v1(numeric,text,numeric) from public, anon, authenticated;
revoke all on function public.proposal_recalculate_version_v1(uuid) from public, anon, authenticated;
revoke all on function public.proposal_item_calculate_v1() from public, anon, authenticated;
revoke all on function public.proposal_item_recalculate_parent_v1() from public, anon, authenticated;
revoke all on function public.proposal_version_immutability_v1() from public, anon, authenticated;

commit;
