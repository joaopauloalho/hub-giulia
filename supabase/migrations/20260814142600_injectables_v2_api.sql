-- Hub Giulia 2.3 — Injetáveis 2.0
-- Draft/autosave/finalization API. All functions are SECURITY INVOKER.

-- -----------------------------------------------------------------------------
-- Create or recover the single open face draft for a patient.
-- -----------------------------------------------------------------------------

create or replace function public.create_injectable_draft_v2(
  p_patient_id uuid,
  p_map_type text default 'face'
)
returns public.injectable_maps
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_map public.injectable_maps;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'INJECTABLE_SESSION_REQUIRED';
  end if;

  if p_patient_id is null then
    raise exception using errcode = '22023', message = 'INJECTABLE_PATIENT_REQUIRED';
  end if;

  if coalesce(nullif(btrim(p_map_type), ''), '') = '' then
    raise exception using errcode = '22023', message = 'INJECTABLE_MAP_TYPE_REQUIRED';
  end if;

  perform 1
  from public.patients p
  where p.id = p_patient_id
    and p.user_id = v_user_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'INJECTABLE_PATIENT_FORBIDDEN';
  end if;

  select im.* into v_map
  from public.injectable_maps im
  where im.user_id = v_user_id
    and im.patient_id = p_patient_id
    and im.map_type = p_map_type
    and im.status = 'draft'
    and im.source_type = 'v2'
    and im.procedure_id is null
  order by im.updated_at desc, im.created_at desc
  limit 1;

  if found then
    return v_map;
  end if;

  begin
    insert into public.injectable_maps (
      patient_id,
      user_id,
      procedure_id,
      points,
      status,
      source_type,
      record_schema_version,
      map_type,
      map_schema_version,
      background_version,
      revision,
      updated_at,
      finalized_at
    ) values (
      p_patient_id,
      v_user_id,
      null,
      '[]'::jsonb,
      'draft',
      'v2',
      2,
      p_map_type,
      2,
      'face-botox-v1',
      1,
      now(),
      null
    )
    returning * into v_map;
  exception
    when unique_violation then
      select im.* into v_map
      from public.injectable_maps im
      where im.user_id = v_user_id
        and im.patient_id = p_patient_id
        and im.map_type = p_map_type
        and im.status = 'draft'
        and im.source_type = 'v2'
        and im.procedure_id is null
      order by im.updated_at desc, im.created_at desc
      limit 1;

      if not found then
        raise;
      end if;
  end;

  return v_map;
end;
$$;

-- -----------------------------------------------------------------------------
-- Save the entire structured draft snapshot with optimistic concurrency.
-- Product/service/lot snapshots are authoritative from the current owned catalog;
-- quantities and coordinates are exactly what the professional entered.
-- No dose suggestion or unit conversion exists here.
-- -----------------------------------------------------------------------------

create or replace function public.save_injectable_draft_v2(
  p_map_id uuid,
  p_expected_revision bigint,
  p_applications jsonb
)
returns public.injectable_maps
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_map public.injectable_maps;
  v_app_json jsonb;
  v_point_json jsonb;
  v_app_id uuid;
  v_point_id uuid;
  v_service_id uuid;
  v_product_id uuid;
  v_lot_id uuid;
  v_service public.services;
  v_product public.injectable_products;
  v_lot public.injectable_product_lots;
  v_x numeric;
  v_y numeric;
  v_quantity numeric;
  v_side text;
  v_color text;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'INJECTABLE_SESSION_REQUIRED';
  end if;

  if p_map_id is null or p_expected_revision is null then
    raise exception using errcode = '22023', message = 'INJECTABLE_DRAFT_ID_REVISION_REQUIRED';
  end if;

  if jsonb_typeof(coalesce(p_applications, 'null'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'INJECTABLE_APPLICATIONS_INVALID';
  end if;

  select im.* into v_map
  from public.injectable_maps im
  where im.id = p_map_id
    and im.user_id = v_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'INJECTABLE_MAP_FORBIDDEN';
  end if;

  if v_map.status <> 'draft' or v_map.source_type <> 'v2' then
    raise exception using errcode = 'P0001', message = 'INJECTABLE_DRAFT_REQUIRED';
  end if;

  if v_map.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'INJECTABLE_REVISION_CONFLICT';
  end if;

  -- Full snapshot replacement keeps autosave deterministic. Cascades remove points.
  delete from public.injectable_applications
  where map_id = p_map_id and user_id = v_user_id;

  for v_app_json in
    select value from jsonb_array_elements(p_applications)
  loop
    if jsonb_typeof(v_app_json) <> 'object' then
      raise exception using errcode = '22023', message = 'INJECTABLE_APPLICATION_INVALID';
    end if;

    begin
      v_app_id := coalesce(nullif(v_app_json ->> 'id', '')::uuid, gen_random_uuid());
      v_service_id := nullif(v_app_json ->> 'service_id', '')::uuid;
      v_product_id := nullif(v_app_json ->> 'product_id', '')::uuid;
      v_lot_id := nullif(v_app_json ->> 'lot_id', '')::uuid;
    exception
      when invalid_text_representation then
        raise exception using errcode = '22023', message = 'INJECTABLE_APPLICATION_ID_INVALID';
    end;

    if v_service_id is null or v_product_id is null then
      raise exception using errcode = '22023', message = 'INJECTABLE_SERVICE_PRODUCT_REQUIRED';
    end if;

    select s.* into v_service
    from public.services s
    where s.id = v_service_id and s.user_id = v_user_id;

    if not found then
      raise exception using errcode = 'P0001', message = 'INJECTABLE_SERVICE_FORBIDDEN';
    end if;

    if not v_service.is_injectable then
      raise exception using errcode = '22023', message = 'INJECTABLE_SERVICE_NOT_INJECTABLE';
    end if;

    select ip.* into v_product
    from public.injectable_products ip
    where ip.id = v_product_id and ip.user_id = v_user_id;

    if not found then
      raise exception using errcode = 'P0001', message = 'INJECTABLE_PRODUCT_FORBIDDEN';
    end if;

    if v_lot_id is not null then
      select l.* into v_lot
      from public.injectable_product_lots l
      where l.id = v_lot_id
        and l.user_id = v_user_id
        and l.product_id = v_product_id;

      if not found then
        raise exception using errcode = 'P0001', message = 'INJECTABLE_LOT_FORBIDDEN';
      end if;
    else
      v_lot := null;
    end if;

    v_color := coalesce(nullif(btrim(v_app_json ->> 'color'), ''), '#be185d');

    insert into public.injectable_applications (
      id,
      map_id,
      user_id,
      service_id,
      procedure_item_id,
      product_id,
      lot_id,
      service_name_snapshot,
      product_name_snapshot,
      product_category_snapshot,
      product_brand_snapshot,
      product_substance_snapshot,
      product_presentation_snapshot,
      unit_snapshot,
      lot_number_snapshot,
      expires_on_snapshot,
      color_snapshot,
      dilution_note,
      total_quantity_snapshot
    ) values (
      v_app_id,
      p_map_id,
      v_user_id,
      v_service.id,
      null,
      v_product.id,
      v_lot_id,
      v_service.name,
      v_product.name,
      v_product.category,
      v_product.brand,
      v_product.substance,
      v_product.presentation,
      btrim(v_product.default_unit),
      case when v_lot_id is null then null else v_lot.lot_number end,
      case when v_lot_id is null then null else v_lot.expires_on end,
      v_color,
      nullif(btrim(v_app_json ->> 'dilution_note'), ''),
      null
    );

    if jsonb_typeof(coalesce(v_app_json -> 'points', '[]'::jsonb)) <> 'array' then
      raise exception using errcode = '22023', message = 'INJECTABLE_POINTS_INVALID';
    end if;

    for v_point_json in
      select value from jsonb_array_elements(coalesce(v_app_json -> 'points', '[]'::jsonb))
    loop
      if jsonb_typeof(v_point_json) <> 'object' then
        raise exception using errcode = '22023', message = 'INJECTABLE_POINT_INVALID';
      end if;

      begin
        v_point_id := coalesce(nullif(v_point_json ->> 'id', '')::uuid, gen_random_uuid());
        v_x := (v_point_json ->> 'x')::numeric;
        v_y := (v_point_json ->> 'y')::numeric;
        v_quantity := (v_point_json ->> 'quantity')::numeric;
      exception
        when invalid_text_representation or numeric_value_out_of_range then
          raise exception using errcode = '22023', message = 'INJECTABLE_POINT_VALUE_INVALID';
      end;

      if v_x is null or v_y is null or v_x < 0 or v_x > 1 or v_y < 0 or v_y > 1 then
        raise exception using errcode = '22023', message = 'INJECTABLE_POINT_COORDINATE_INVALID';
      end if;

      if v_quantity is null or v_quantity <= 0 then
        raise exception using errcode = '22023', message = 'INJECTABLE_POINT_QUANTITY_INVALID';
      end if;

      v_side := nullif(btrim(v_point_json ->> 'side'), '');
      if v_side is not null and v_side not in ('left', 'right', 'center', 'none') then
        raise exception using errcode = '22023', message = 'INJECTABLE_POINT_SIDE_INVALID';
      end if;

      insert into public.injectable_application_points (
        id,
        application_id,
        map_id,
        user_id,
        x,
        y,
        quantity,
        unit_snapshot,
        region,
        side,
        note
      ) values (
        v_point_id,
        v_app_id,
        p_map_id,
        v_user_id,
        v_x,
        v_y,
        v_quantity,
        btrim(v_product.default_unit),
        nullif(btrim(v_point_json ->> 'region'), ''),
        v_side,
        nullif(btrim(v_point_json ->> 'note'), '')
      );
    end loop;
  end loop;

  update public.injectable_maps
  set revision = revision + 1,
      updated_at = now()
  where id = p_map_id and user_id = v_user_id
  returning * into v_map;

  return v_map;
end;
$$;

-- -----------------------------------------------------------------------------
-- Explicitly discard only an owned draft. Historical sessions cannot be deleted.
-- -----------------------------------------------------------------------------

create or replace function public.discard_injectable_draft_v2(
  p_map_id uuid,
  p_expected_revision bigint
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_map public.injectable_maps;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'INJECTABLE_SESSION_REQUIRED';
  end if;

  select im.* into v_map
  from public.injectable_maps im
  where im.id = p_map_id and im.user_id = v_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'INJECTABLE_MAP_FORBIDDEN';
  end if;

  if v_map.status <> 'draft' then
    raise exception using errcode = 'P0001', message = 'INJECTABLE_FINALIZED_IMMUTABLE';
  end if;

  if v_map.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'INJECTABLE_REVISION_CONFLICT';
  end if;

  delete from public.injectable_maps
  where id = p_map_id and user_id = v_user_id and status = 'draft';

  return true;
end;
$$;

-- -----------------------------------------------------------------------------
-- Finalization: backend validates ownership/linkage, derives totals from points,
-- creates a rich compatibility snapshot in injectable_maps.points, and freezes it.
-- -----------------------------------------------------------------------------

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

  select im.* into v_map
  from public.injectable_maps im
  where im.id = p_map_id and im.user_id = v_user_id
  for update;

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

  -- Link each application to its exact procedure item and derive totals in NUMERIC.
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

  -- Compatibility snapshot: old preview/PDF readers still see all finalized points.
  -- Rich v2 fields are additive; legacy consumers ignore unknown keys.
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

-- -----------------------------------------------------------------------------
-- Atomic attendance wrapper. The existing create_procedure_v2 contract remains
-- untouched for all existing consumers. This wrapper creates procedure/items/
-- payments with the proven v2 RPC, then finalizes the structured draft in the
-- SAME Postgres transaction; any finalization error rolls the whole call back.
-- -----------------------------------------------------------------------------

create or replace function public.create_procedure_with_injectable_draft_v2(
  p_idempotency_key uuid,
  p_patient_id uuid,
  p_appointment_id uuid,
  p_performed_at timestamptz,
  p_items jsonb,
  p_payment_entries jsonb,
  p_notes text,
  p_injectable_draft_id uuid,
  p_injectable_draft_revision bigint
)
returns public.procedures
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_proc public.procedures;
begin
  if p_injectable_draft_id is null or p_injectable_draft_revision is null then
    raise exception using errcode = '22023', message = 'INJECTABLE_DRAFT_ID_REVISION_REQUIRED';
  end if;

  select * into v_proc
  from public.create_procedure_v2(
    p_idempotency_key,
    p_patient_id,
    p_appointment_id,
    p_performed_at,
    p_items,
    p_payment_entries,
    '[]'::jsonb,
    p_notes
  );

  perform public.finalize_injectable_map_v2(
    p_injectable_draft_id,
    p_injectable_draft_revision,
    v_proc.id,
    p_idempotency_key
  );

  return v_proc;
end;
$$;

-- Explicit function surface: no anonymous execution.
revoke all on function public.create_injectable_draft_v2(uuid, text) from public, anon;
revoke all on function public.save_injectable_draft_v2(uuid, bigint, jsonb) from public, anon;
revoke all on function public.discard_injectable_draft_v2(uuid, bigint) from public, anon;
revoke all on function public.finalize_injectable_map_v2(uuid, bigint, uuid, uuid) from public, anon;
revoke all on function public.create_procedure_with_injectable_draft_v2(uuid, uuid, uuid, timestamptz, jsonb, jsonb, text, uuid, bigint) from public, anon;

grant execute on function public.create_injectable_draft_v2(uuid, text) to authenticated, service_role;
grant execute on function public.save_injectable_draft_v2(uuid, bigint, jsonb) to authenticated, service_role;
grant execute on function public.discard_injectable_draft_v2(uuid, bigint) to authenticated, service_role;
grant execute on function public.finalize_injectable_map_v2(uuid, bigint, uuid, uuid) to authenticated, service_role;
grant execute on function public.create_procedure_with_injectable_draft_v2(uuid, uuid, uuid, timestamptz, jsonb, jsonb, text, uuid, bigint) to authenticated, service_role;
