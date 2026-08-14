begin;

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

  select tp.* into v_proposal
  from public.treatment_proposals tp
  where tp.user_id = v_uid and tp.idempotency_key = p_idempotency_key;
  if found then
    select pv.* into v_version
    from public.treatment_proposal_versions pv
    where pv.proposal_id = v_proposal.id
    order by pv.version_number desc
    limit 1;
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

  select pv.* into v_new
  from public.treatment_proposal_versions pv
  where pv.user_id=v_uid and pv.revision_idempotency_key=p_idempotency_key;
  if found then
    return query select v_new.proposal_id,v_new.id,v_new.version_number,v_new.draft_revision;
    return;
  end if;

  select pv.* into v_source
  from public.treatment_proposal_versions pv
  where pv.id=p_source_version_id and pv.user_id=v_uid
  for share;
  if not found then raise exception 'PROPOSAL_VERSION_NOT_FOUND'; end if;
  if v_source.status = 'draft' then raise exception 'PROPOSAL_SOURCE_IS_DRAFT'; end if;
  if v_source.status = 'accepted' then raise exception 'PROPOSAL_ACCEPTED_IMMUTABLE'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_source.proposal_id::text,0));
  if exists(select 1 from public.treatment_proposal_versions pv where pv.proposal_id=v_source.proposal_id and pv.status='draft') then raise exception 'PROPOSAL_DRAFT_ALREADY_EXISTS'; end if;
  select coalesce(max(pv.version_number),0)+1 into v_next
  from public.treatment_proposal_versions pv
  where pv.proposal_id=v_source.proposal_id;

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
  select pi.user_id,v_new.id,pi.service_id,pi.service_name_snapshot,pi.description_snapshot,pi.interval_note,pi.quantity,pi.unit_label,
         pi.list_unit_price_snapshot,pi.offered_unit_price,pi.discount_type,pi.discount_value,pi.sort_order
  from public.treatment_proposal_items pi
  where pi.proposal_version_id=v_source.id
  order by pi.sort_order,pi.id;
  perform set_config('app.proposal_skip_recalc','off',true);
  perform public.proposal_recalculate_version_v1(v_new.id);
  select pv.* into v_new from public.treatment_proposal_versions pv where pv.id=v_new.id;

  select tp.deal_id,d.contact_id into v_deal,v_contact
  from public.treatment_proposals tp
  join public.deals d on d.id=tp.deal_id and d.user_id=tp.user_id
  where tp.id=v_new.proposal_id;
  insert into public.crm_activities(user_id,contact_id,deal_id,activity_type,note,metadata,actor_user_id)
  values(v_uid,v_contact,v_deal,'proposal_revised','Nova versão da proposta criada',jsonb_build_object('proposal_id',v_new.proposal_id,'source_version_id',v_source.id,'version_id',v_new.id,'version_number',v_new.version_number),v_uid);

  return query select v_new.proposal_id,v_new.id,v_new.version_number,v_new.draft_revision;
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
  select pv.* into v_version
  from public.treatment_proposal_versions pv
  where pv.id=p_version_id and pv.user_id=v_uid
  for update;
  if not found then raise exception 'PROPOSAL_VERSION_NOT_FOUND'; end if;
  if v_version.status='accepted' and v_version.accept_idempotency_key=p_idempotency_key then
    select d.* into v_deal
    from public.treatment_proposals tp
    join public.deals d on d.id=tp.deal_id and d.user_id=tp.user_id
    where tp.id=v_version.proposal_id;
    return query select v_version.id,v_version.status,v_version.accepted_at,v_deal.stage,v_deal.value;
    return;
  end if;
  if v_version.status <> 'issued' then raise exception 'PROPOSAL_NOT_ISSUED'; end if;
  if v_version.valid_until < (now() at time zone 'America/Sao_Paulo')::date then raise exception 'PROPOSAL_EXPIRED_CREATE_REVISION'; end if;
  if exists(select 1 from public.treatment_proposal_versions pv where pv.proposal_id=v_version.proposal_id and pv.status='accepted' and pv.id<>v_version.id) then raise exception 'PROPOSAL_ALREADY_ACCEPTED'; end if;
  select d.* into v_deal
  from public.treatment_proposals tp
  join public.deals d on d.id=tp.deal_id and d.user_id=tp.user_id
  where tp.id=v_version.proposal_id
  for update of d;
  if coalesce(p_mark_deal_won,false) and v_deal.stage='lost' then raise exception 'PROPOSAL_DEAL_LOST_REOPEN_FIRST'; end if;
  v_contact:=v_deal.contact_id; v_from:=v_deal.stage;
  update public.treatment_proposal_versions pv
  set status='accepted',accepted_at=now(),accept_idempotency_key=p_idempotency_key
  where pv.id=v_version.id
  returning pv.* into v_version;
  update public.deals d set value=v_version.total_value,
      stage=case when coalesce(p_mark_deal_won,false) then 'won' else d.stage end,
      won_at=case when coalesce(p_mark_deal_won,false) then coalesce(d.won_at,now()) else d.won_at end,
      closed_at=case when coalesce(p_mark_deal_won,false) then coalesce(d.closed_at,now()) else d.closed_at end,
      updated_at=now()
  where d.id=v_deal.id and d.user_id=v_uid
  returning d.* into v_deal;
  insert into public.crm_activities(user_id,contact_id,deal_id,activity_type,note,from_stage,to_stage,metadata,actor_user_id)
  values(v_uid,v_contact,v_deal.id,'proposal_accepted',case when coalesce(p_mark_deal_won,false) then 'Proposta aceita e oportunidade ganha' else 'Proposta aceita' end,v_from,v_deal.stage,jsonb_build_object('proposal_id',v_version.proposal_id,'version_id',v_version.id,'version_number',v_version.version_number,'total_value',v_version.total_value,'deal_won',coalesce(p_mark_deal_won,false)),v_uid);
  return query select v_version.id,v_version.status,v_version.accepted_at,v_deal.stage,v_deal.value;
end;
$$;

commit;
