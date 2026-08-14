-- Hub Giulia 2.3 — Injetáveis 2.0
-- Serialize finalization attempts before row locking so a repeated/concurrent
-- finalize can observe the committed finalized row and return idempotently.

create or replace function public.finalize_injectable_map_v2(
  p_map_id uuid,
  p_expected_revision bigint,
  p_procedure_id uuid,
  p_idempotency_key uuid
)
returns public.injectable_maps
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_map public.injectable_maps;
  v_procedure public.procedures;
  v_existing_map_id uuid;
  v_points_snapshot jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'INJECTABLE_SESSION_REQUIRED';
  end if;

  if p_map_id is null or p_expected_revision is null or p_procedure_id is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'INJECTABLE_FINALIZE_ARGUMENT_REQUIRED';
  end if;

  -- Serialize all attempts for this map before inspecting lifecycle state.
  -- This makes simultaneous double taps deterministic without relaxing RLS.
  perform pg_advisory_xact_lock(hashtextextended(p_map_id::text, 0));

  select im.* into v_map
  from public.injectable_maps im
  where im.id = p_map_id and im.user_id = v_user_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'INJECTABLE_MAP_FORBIDDEN';
  end if;

  if v_map.status = 'finalized' then
    if v_map.procedure_id = p_procedure_id and v_map.finalization_key = p_idempotency_key then
      return v_map;
    end if;
    raise exception using errcode = 'P0001', message = 'INJECTABLE_ALREADY_FINALIZED';
  end if;

  if v_map.status <> 'draft' or v_map.source_type <> 'v2' then
    raise exception using errcode = 'P0001', message = 'INJECTABLE_DRAFT_REQUIRED';
  end if;

  -- Draft rows are mutable and therefore visible to the UPDATE policy for lock.
  select im.* into v_map
  from public.injectable_maps im
  where im.id = p_map_id
    and im.user_id = v_user_id
    and im.status = 'draft'
  for update;

  if not found then
    raise exception using errcode = '40001', message = 'INJECTABLE_FINALIZE_CONFLICT';
  end if;

  if v_map.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'INJECTABLE_REVISION_CONFLICT';
  end if;

  select p.* into v_procedure
  from public.procedures p
  where p.id = p_procedure_id and p.user_id = v_user_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'INJECTABLE_PROCEDURE_FORBIDDEN';
  end if;

  if v_procedure.patient_id <> v_map.patient_id then
    raise exception using errcode = 'P0001', message = 'INJECTABLE_PROCEDURE_PATIENT_MISMATCH';
  end if;

  select im.id into v_existing_map_id
  from public.injectable_maps im
  where im.user_id = v_user_id
    and im.finalization_key = p_idempotency_key
    and im.id <> p_map_id
  limit 1;

  if found then
    raise exception using errcode = 'P0001', message = 'INJECTABLE_IDEMPOTENCY_CONFLICT';
  end if;

  if not exists (
    select 1 from public.injectable_applications a
    where a.map_id = p_map_id and a.user_id = v_user_id
  ) then
    raise exception using errcode = '22023', message = 'INJECTABLE_APPLICATION_REQUIRED';
  end if;

  if exists (
    select 1
    from public.injectable_applications a
    where a.map_id = p_map_id
      and a.user_id = v_user_id
      and not exists (
        select 1
        from public.procedure_items pi
        where pi.procedure_id = p_procedure_id
          and pi.user_id = v_user_id
          and pi.service_id = a.service_id
      )
  ) then
    raise exception using errcode = 'P0001', message = 'INJECTABLE_PROCEDURE_ITEM_MISMATCH';
  end if;

  if exists (
    select 1
    from public.injectable_applications a
    where a.map_id = p_map_id
      and a.user_id = v_user_id
      and not exists (
        select 1
        from public.injectable_application_points ap
        where ap.application_id = a.id
          and ap.map_id = p_map_id
          and ap.user_id = v_user_id
          and ap.quantity > 0
      )
  ) then
    raise exception using errcode = '22023', message = 'INJECTABLE_APPLICATION_POINTS_REQUIRED';
  end if;

  if exists (
    select 1
    from public.injectable_application_points ap
    join public.injectable_applications a
      on a.id = ap.application_id
     and a.map_id = ap.map_id
     and a.user_id = ap.user_id
    where ap.map_id = p_map_id
      and ap.user_id = v_user_id
      and (
        ap.quantity <= 0
        or ap.x < 0 or ap.x > 1
        or ap.y < 0 or ap.y > 1
        or btrim(ap.unit_snapshot) = ''
        or ap.unit_snapshot <> a.unit_snapshot
      )
  ) then
    raise exception using errcode = '22023', message = 'INJECTABLE_POINT_INVALID';
  end if;

  update public.injectable_applications a
  set procedure_item_id = (
        select pi.id
        from public.procedure_items pi
        where pi.procedure_id = p_procedure_id
          and pi.user_id = v_user_id
          and pi.service_id = a.service_id
        order by pi.created_at, pi.id
        limit 1
      ),
      total_quantity_snapshot = (
        select sum(ap.quantity)
        from public.injectable_application_points ap
        where ap.application_id = a.id
          and ap.map_id = p_map_id
          and ap.user_id = v_user_id
      )
  where a.map_id = p_map_id
    and a.user_id = v_user_id;

  select coalesce(
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'id', ap.id::text,
        'application_id', a.id::text,
        'x', ap.x,
        'y', ap.y,
        'service_id', a.service_id::text,
        'service_name', a.service_name_snapshot,
        'color', a.color_snapshot,
        'quantity', ap.quantity,
        'unit', a.unit_snapshot,
        'product_id', a.product_id::text,
        'product_name', a.product_name_snapshot,
        'product_category', a.product_category_snapshot,
        'product_brand', a.product_brand_snapshot,
        'product_substance', a.product_substance_snapshot,
        'product_presentation', a.product_presentation_snapshot,
        'lot_id', case when a.lot_id is null then null else a.lot_id::text end,
        'lot_number', a.lot_number_snapshot,
        'expires_on', a.expires_on_snapshot,
        'region', ap.region,
        'side', ap.side,
        'note', ap.note
      ))
      order by a.created_at, a.id, ap.created_at, ap.id
    ),
    '[]'::jsonb
  ) into v_points_snapshot
  from public.injectable_applications a
  join public.injectable_application_points ap
    on ap.application_id = a.id
   and ap.map_id = a.map_id
   and ap.user_id = a.user_id
  where a.map_id = p_map_id
    and a.user_id = v_user_id;

  perform set_config('hub.injectable_finalizing', '1', true);

  update public.injectable_maps
  set procedure_id = p_procedure_id,
      status = 'finalized',
      finalized_at = now(),
      updated_at = now(),
      finalization_key = p_idempotency_key,
      points = v_points_snapshot,
      revision = revision + 1
  where id = p_map_id and user_id = v_user_id
  returning * into v_map;

  return v_map;
end;
$$;

revoke all on function public.finalize_injectable_map_v2(uuid, bigint, uuid, uuid) from public, anon;
grant execute on function public.finalize_injectable_map_v2(uuid, bigint, uuid, uuid) to authenticated, service_role;
