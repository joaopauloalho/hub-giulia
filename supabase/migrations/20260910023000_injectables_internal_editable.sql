-- Hub Giulia — Injetáveis internos, editáveis e com rastreabilidade complementar
-- A paciente não assina este registro. O profissional pode complementar o mesmo
-- registro finalizado posteriormente, mantendo revisionamento e auditoria.

alter table public.injectable_maps
  add column if not exists procedure_summary text;

alter table public.injectable_applications
  add column if not exists label_photo_path text;

create table if not exists public.injectable_record_edits (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.injectable_maps(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  revision_before bigint not null,
  revision_after bigint not null,
  edited_at timestamptz not null default now(),
  constraint injectable_record_edits_revision_check check (revision_after > revision_before)
);

create index if not exists injectable_record_edits_map_idx
  on public.injectable_record_edits (user_id, map_id, edited_at desc);

alter table public.injectable_record_edits enable row level security;

drop policy if exists injectable_record_edits_select_own on public.injectable_record_edits;
create policy injectable_record_edits_select_own
on public.injectable_record_edits for select to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()));

revoke all on table public.injectable_record_edits from public, anon;
grant select on table public.injectable_record_edits to authenticated;
grant select, insert, update, delete on table public.injectable_record_edits to service_role;

-- Keep the original immutability contract for ordinary table writes, but permit
-- the controlled edit RPC below to make an atomic, audited change.
create or replace function public.guard_injectable_map_history_v2()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception using errcode = 'P0001', message = 'INJECTABLE_FINALIZED_IMMUTABLE';
    end if;
    return old;
  end if;

  if old.status <> 'draft'
     and coalesce(current_setting('hub.injectable_editing', true), '') <> '1' then
    raise exception using errcode = 'P0001', message = 'INJECTABLE_FINALIZED_IMMUTABLE';
  end if;

  if new.id <> old.id
     or new.user_id <> old.user_id
     or new.patient_id <> old.patient_id
     or new.source_type <> old.source_type
     or new.record_schema_version <> old.record_schema_version
     or new.map_type <> old.map_type
     or new.map_schema_version <> old.map_schema_version
     or new.background_version <> old.background_version
     or new.created_at <> old.created_at then
    raise exception using errcode = 'P0001', message = 'INJECTABLE_MAP_IDENTITY_IMMUTABLE';
  end if;

  if old.status = 'draft'
     and new.status <> 'draft'
     and coalesce(current_setting('hub.injectable_finalizing', true), '') <> '1' then
    raise exception using errcode = 'P0001', message = 'INJECTABLE_FINALIZE_RPC_REQUIRED';
  end if;

  return new;
end;
$$;

create or replace function public.guard_injectable_child_history_v2()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_map_id uuid;
  v_status text;
begin
  v_map_id := case when tg_op = 'DELETE' then old.map_id else new.map_id end;

  select im.status into v_status
  from public.injectable_maps im
  where im.id = v_map_id;

  if v_status is null and tg_op = 'DELETE' then
    return old;
  end if;

  if v_status is distinct from 'draft'
     and coalesce(current_setting('hub.injectable_editing', true), '') <> '1' then
    raise exception using errcode = 'P0001', message = 'INJECTABLE_FINALIZED_IMMUTABLE';
  end if;

  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.user_id <> old.user_id or new.map_id <> old.map_id then
      raise exception using errcode = 'P0001', message = 'INJECTABLE_CHILD_IDENTITY_IMMUTABLE';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Replaces the structured content of one FINALIZED V2 map, preserving its id,
-- patient, procedure and original finalization timestamp. This is deliberately
-- SECURITY DEFINER so RLS policies can remain draft-only; ownership is checked
-- explicitly before any write.
create or replace function public.save_finalized_injectable_record_v2(
  p_map_id uuid,
  p_expected_revision bigint,
  p_applications jsonb,
  p_procedure_summary text default null
)
returns public.injectable_maps
language plpgsql
security definer
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
  v_points_snapshot jsonb;
  v_revision_before bigint;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'INJECTABLE_SESSION_REQUIRED';
  end if;

  if p_map_id is null or p_expected_revision is null then
    raise exception using errcode = '22023', message = 'INJECTABLE_MAP_ID_REVISION_REQUIRED';
  end if;

  if jsonb_typeof(coalesce(p_applications, 'null'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'INJECTABLE_APPLICATIONS_INVALID';
  end if;

  select im.* into v_map
  from public.injectable_maps im
  where im.id = p_map_id and im.user_id = v_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'INJECTABLE_MAP_FORBIDDEN';
  end if;

  if v_map.status <> 'finalized' or v_map.source_type <> 'v2' then
    raise exception using errcode = 'P0001', message = 'INJECTABLE_FINALIZED_V2_REQUIRED';
  end if;

  if v_map.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'INJECTABLE_REVISION_CONFLICT';
  end if;

  v_revision_before := v_map.revision;
  perform set_config('hub.injectable_editing', '1', true);

  delete from public.injectable_applications
  where map_id = p_map_id and user_id = v_user_id;

  for v_app_json in select value from jsonb_array_elements(p_applications)
  loop
    begin
      v_app_id := coalesce(nullif(v_app_json ->> 'id', '')::uuid, gen_random_uuid());
      v_service_id := nullif(v_app_json ->> 'service_id', '')::uuid;
      v_product_id := nullif(v_app_json ->> 'product_id', '')::uuid;
      v_lot_id := nullif(v_app_json ->> 'lot_id', '')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'INJECTABLE_APPLICATION_ID_INVALID';
    end;

    if v_service_id is null or v_product_id is null then
      raise exception using errcode = '22023', message = 'INJECTABLE_SERVICE_PRODUCT_REQUIRED';
    end if;

    select s.* into v_service from public.services s
    where s.id = v_service_id and s.user_id = v_user_id and s.is_injectable;
    if not found then
      raise exception using errcode = 'P0001', message = 'INJECTABLE_SERVICE_FORBIDDEN';
    end if;

    select ip.* into v_product from public.injectable_products ip
    where ip.id = v_product_id and ip.user_id = v_user_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'INJECTABLE_PRODUCT_FORBIDDEN';
    end if;

    if v_lot_id is not null then
      select l.* into v_lot from public.injectable_product_lots l
      where l.id = v_lot_id and l.user_id = v_user_id and l.product_id = v_product_id;
      if not found then
        raise exception using errcode = 'P0001', message = 'INJECTABLE_LOT_FORBIDDEN';
      end if;
    else
      v_lot := null;
    end if;

    v_color := coalesce(nullif(btrim(v_app_json ->> 'color'), ''), '#be185d');

    insert into public.injectable_applications (
      id, map_id, user_id, service_id, procedure_item_id, product_id, lot_id,
      service_name_snapshot, product_name_snapshot, product_category_snapshot,
      product_brand_snapshot, product_substance_snapshot, product_presentation_snapshot,
      unit_snapshot, lot_number_snapshot, expires_on_snapshot, color_snapshot,
      dilution_note, total_quantity_snapshot, label_photo_path
    ) values (
      v_app_id, p_map_id, v_user_id, v_service.id,
      case when v_map.procedure_id is null then null else (
        select pi.id from public.procedure_items pi
        where pi.procedure_id = v_map.procedure_id and pi.user_id = v_user_id and pi.service_id = v_service.id
        order by pi.created_at, pi.id limit 1
      ) end,
      v_product.id, v_lot_id, v_service.name, v_product.name, v_product.category,
      v_product.brand, v_product.substance, v_product.presentation, btrim(v_product.default_unit),
      case when v_lot_id is null then null else v_lot.lot_number end,
      case when v_lot_id is null then null else v_lot.expires_on end,
      v_color, nullif(btrim(v_app_json ->> 'dilution_note'), ''), null,
      nullif(btrim(v_app_json ->> 'label_photo_path'), '')
    );

    if jsonb_typeof(coalesce(v_app_json -> 'points', '[]'::jsonb)) <> 'array' then
      raise exception using errcode = '22023', message = 'INJECTABLE_POINTS_INVALID';
    end if;

    for v_point_json in select value from jsonb_array_elements(coalesce(v_app_json -> 'points', '[]'::jsonb))
    loop
      begin
        v_point_id := coalesce(nullif(v_point_json ->> 'id', '')::uuid, gen_random_uuid());
        v_x := (v_point_json ->> 'x')::numeric;
        v_y := (v_point_json ->> 'y')::numeric;
        v_quantity := (v_point_json ->> 'quantity')::numeric;
      exception when invalid_text_representation or numeric_value_out_of_range then
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
        id, application_id, map_id, user_id, x, y, quantity, unit_snapshot, region, side, note
      ) values (
        v_point_id, v_app_id, p_map_id, v_user_id, v_x, v_y, v_quantity,
        btrim(v_product.default_unit), nullif(btrim(v_point_json ->> 'region'), ''),
        v_side, nullif(btrim(v_point_json ->> 'note'), '')
      );
    end loop;

    update public.injectable_applications a
    set total_quantity_snapshot = (
      select sum(ap.quantity) from public.injectable_application_points ap
      where ap.application_id = a.id and ap.map_id = p_map_id and ap.user_id = v_user_id
    )
    where a.id = v_app_id and a.user_id = v_user_id;
  end loop;

  select coalesce(jsonb_agg(
    jsonb_strip_nulls(jsonb_build_object(
      'id', ap.id::text, 'application_id', a.id::text, 'x', ap.x, 'y', ap.y,
      'service_id', a.service_id::text, 'service_name', a.service_name_snapshot,
      'color', a.color_snapshot, 'quantity', ap.quantity, 'unit', a.unit_snapshot,
      'product_id', a.product_id::text, 'product_name', a.product_name_snapshot,
      'product_category', a.product_category_snapshot, 'product_brand', a.product_brand_snapshot,
      'product_substance', a.product_substance_snapshot, 'product_presentation', a.product_presentation_snapshot,
      'lot_id', case when a.lot_id is null then null else a.lot_id::text end,
      'lot_number', a.lot_number_snapshot, 'expires_on', a.expires_on_snapshot,
      'region', ap.region, 'side', ap.side, 'note', ap.note
    )) order by a.created_at, a.id, ap.created_at, ap.id
  ), '[]'::jsonb) into v_points_snapshot
  from public.injectable_applications a
  join public.injectable_application_points ap
    on ap.application_id = a.id and ap.map_id = a.map_id and ap.user_id = a.user_id
  where a.map_id = p_map_id and a.user_id = v_user_id;

  update public.injectable_maps
  set points = v_points_snapshot,
      procedure_summary = nullif(btrim(p_procedure_summary), ''),
      revision = revision + 1,
      updated_at = now()
  where id = p_map_id and user_id = v_user_id
  returning * into v_map;

  insert into public.injectable_record_edits(map_id, user_id, revision_before, revision_after)
  values (p_map_id, v_user_id, v_revision_before, v_map.revision);

  return v_map;
end;
$$;

revoke all on function public.save_finalized_injectable_record_v2(uuid, bigint, jsonb, text) from public, anon;
grant execute on function public.save_finalized_injectable_record_v2(uuid, bigint, jsonb, text) to authenticated, service_role;

-- Optional label photos live in a private bucket, isolated by user id folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('injectable-labels', 'injectable-labels', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists injectable_labels_select_own on storage.objects;
create policy injectable_labels_select_own
on storage.objects for select to authenticated
using (bucket_id = 'injectable-labels' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists injectable_labels_insert_own on storage.objects;
create policy injectable_labels_insert_own
on storage.objects for insert to authenticated
with check (bucket_id = 'injectable-labels' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists injectable_labels_update_own on storage.objects;
create policy injectable_labels_update_own
on storage.objects for update to authenticated
using (bucket_id = 'injectable-labels' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'injectable-labels' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists injectable_labels_delete_own on storage.objects;
create policy injectable_labels_delete_own
on storage.objects for delete to authenticated
using (bucket_id = 'injectable-labels' and (storage.foldername(name))[1] = (select auth.uid())::text);