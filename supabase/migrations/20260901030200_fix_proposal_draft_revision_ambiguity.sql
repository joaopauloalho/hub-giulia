begin;

-- Fix PostgreSQL ambiguity between the RETURNS TABLE output column `draft_revision`
-- and treatment_proposal_versions.draft_revision inside the v2 draft save RPC.
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

  select * into v_version
  from public.treatment_proposal_versions
  where id = p_version_id and user_id = v_uid
  for update;

  if not found then raise exception 'PROPOSAL_VERSION_NOT_FOUND'; end if;
  if v_version.status <> 'draft' then raise exception 'PROPOSAL_VERSION_IMMUTABLE'; end if;
  if v_version.draft_revision <> coalesce(p_expected_revision, -1) then raise exception 'PROPOSAL_DRAFT_CONFLICT'; end if;
  if nullif(btrim(p_title), '') is null then raise exception 'PROPOSAL_TITLE_REQUIRED'; end if;
  if p_discount_type not in ('none', 'amount', 'percent') then raise exception 'PROPOSAL_INVALID_DISCOUNT_TYPE'; end if;
  if p_discount_type = 'none' and coalesce(p_discount_value, 0) <> 0 then raise exception 'PROPOSAL_NONE_DISCOUNT_VALUE'; end if;
  if coalesce(p_discount_value, 0) < 0 or (p_discount_type = 'percent' and coalesce(p_discount_value, 0) > 100) then raise exception 'PROPOSAL_INVALID_DISCOUNT'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'PROPOSAL_ITEMS_INVALID'; end if;

  update public.treatment_proposal_versions
  set title = btrim(p_title),
      valid_until = p_valid_until,
      payment_terms = nullif(btrim(p_payment_terms), ''),
      internal_note = nullif(btrim(p_internal_note), ''),
      customer_note = nullif(btrim(p_customer_note), ''),
      discount_type = p_discount_type,
      discount_value = coalesce(p_discount_value, 0),
      updated_at = now()
  where id = p_version_id;

  perform set_config('app.proposal_skip_recalc', 'on', true);
  delete from public.treatment_proposal_items
  where proposal_version_id = p_version_id and user_id = v_uid;

  for v_item, v_ord in
    select value, ordinality
    from jsonb_array_elements(p_items) with ordinality
  loop
    v_service := nullif(v_item->>'service_id', '')::uuid;
    if v_service is not null and not exists(
      select 1 from public.services s where s.id = v_service and s.user_id = v_uid
    ) then
      raise exception 'PROPOSAL_SERVICE_NOT_FOUND';
    end if;

    v_name := nullif(btrim(v_item->>'service_name_snapshot'), '');
    if v_name is null then raise exception 'PROPOSAL_ITEM_NAME_REQUIRED'; end if;

    v_qty := coalesce(nullif(v_item->>'quantity', '')::numeric, 1);
    v_list := coalesce(nullif(v_item->>'list_unit_price_snapshot', '')::numeric, 0);
    v_offered := coalesce(nullif(v_item->>'offered_unit_price', '')::numeric, 0);
    v_dtype := coalesce(nullif(v_item->>'discount_type', ''), 'none');
    v_dvalue := coalesce(nullif(v_item->>'discount_value', '')::numeric, 0);
    v_unit := coalesce(nullif(btrim(v_item->>'unit_label'), ''), 'procedimento');

    insert into public.treatment_proposal_items(
      user_id,
      proposal_version_id,
      service_id,
      service_name_snapshot,
      description_snapshot,
      interval_note,
      payment_condition,
      quantity,
      unit_label,
      list_unit_price_snapshot,
      offered_unit_price,
      discount_type,
      discount_value,
      sort_order
    ) values (
      v_uid,
      p_version_id,
      v_service,
      v_name,
      nullif(btrim(v_item->>'description_snapshot'), ''),
      nullif(btrim(v_item->>'interval_note'), ''),
      nullif(btrim(v_item->>'payment_condition'), ''),
      v_qty,
      v_unit,
      v_list,
      v_offered,
      v_dtype,
      v_dvalue,
      coalesce(nullif(v_item->>'sort_order', '')::integer, v_ord::integer - 1)
    );
  end loop;

  perform set_config('app.proposal_skip_recalc', 'off', true);
  perform public.proposal_recalculate_version_v1(p_version_id);

  update public.treatment_proposal_versions as tpv
  set draft_revision = tpv.draft_revision + 1,
      updated_at = now()
  where tpv.id = p_version_id
  returning tpv.* into v_version;

  return query
  select
    v_version.id,
    v_version.draft_revision,
    v_version.subtotal,
    v_version.item_discount_amount,
    v_version.net_subtotal,
    v_version.discount_amount,
    v_version.total_value,
    v_version.updated_at;
end;
$$;

revoke all on function public.save_treatment_proposal_draft_v2(uuid,bigint,text,date,text,text,text,text,numeric,jsonb) from public;
grant execute on function public.save_treatment_proposal_draft_v2(uuid,bigint,text,date,text,text,text,text,numeric,jsonb) to authenticated, service_role;

commit;
