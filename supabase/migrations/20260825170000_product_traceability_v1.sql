-- Hub Giulia 4.6 — clinical product traceability v1
-- Additive, backwards-compatible foundation for lot/expiry/photo evidence.

alter table public.materials
  add column if not exists traceability_mode text not null default 'none';

alter table public.materials
  drop constraint if exists materials_traceability_mode_check;
alter table public.materials
  add constraint materials_traceability_mode_check
  check (traceability_mode in ('none','optional','recommended'));

alter table public.injectable_products
  add column if not exists traceability_mode text not null default 'recommended';
alter table public.injectable_products
  drop constraint if exists injectable_products_traceability_mode_check;
alter table public.injectable_products
  add constraint injectable_products_traceability_mode_check
  check (traceability_mode in ('none','optional','recommended'));

create table if not exists public.procedure_product_traceability (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null,
  procedure_id uuid references public.procedures(id) on delete set null,
  procedure_id_snapshot uuid not null,
  performed_at_snapshot timestamptz not null,
  source_kind text not null check (source_kind in ('injectable_application','procedure_material')),
  source_ref_snapshot uuid not null,
  injectable_application_id uuid references public.injectable_applications(id) on delete set null,
  procedure_material_id uuid references public.procedure_materials(id) on delete set null,
  injectable_product_id uuid references public.injectable_products(id) on delete set null,
  material_id uuid references public.materials(id) on delete set null,
  product_ref_snapshot uuid not null,
  product_name_snapshot text not null check (btrim(product_name_snapshot) <> ''),
  brand_snapshot text,
  presentation_snapshot text,
  lot_number_snapshot text,
  expires_on_snapshot date,
  quantity_snapshot numeric(18,3) not null check (quantity_snapshot > 0),
  unit_snapshot text not null check (btrim(unit_snapshot) <> ''),
  traceability_mode_snapshot text not null check (traceability_mode_snapshot in ('none','optional','recommended')),
  status text not null default 'active' check (status in ('active','reverted','voided')),
  procedure_reverted_at timestamptz,
  voided_at timestamptz,
  voided_by uuid references auth.users(id),
  void_reason text,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  constraint procedure_product_traceability_patient_owner_fkey
    foreign key (patient_id, user_id) references public.patients(id, user_id),
  constraint procedure_product_traceability_source_shape_check check (
    (source_kind='injectable_application' and material_id is null and procedure_material_id is null)
    or
    (source_kind='procedure_material' and injectable_product_id is null and injectable_application_id is null)
  ),
  constraint procedure_product_traceability_void_check check (
    status <> 'voided' or (voided_at is not null and voided_by is not null and length(btrim(coalesce(void_reason,''))) >= 3)
  ),
  unique (id, user_id),
  unique (user_id, procedure_id_snapshot, source_kind, source_ref_snapshot)
);

create index if not exists procedure_product_traceability_patient_idx
  on public.procedure_product_traceability(user_id, patient_id, performed_at_snapshot desc);
create index if not exists procedure_product_traceability_procedure_idx
  on public.procedure_product_traceability(user_id, procedure_id_snapshot);
create index if not exists procedure_product_traceability_lot_idx
  on public.procedure_product_traceability(user_id, lower(btrim(lot_number_snapshot)))
  where lot_number_snapshot is not null;
create index if not exists procedure_product_traceability_product_lot_idx
  on public.procedure_product_traceability(user_id, product_ref_snapshot, lower(btrim(lot_number_snapshot)))
  where lot_number_snapshot is not null;

create table if not exists public.product_traceability_evidence (
  id uuid primary key,
  client_upload_id uuid not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null,
  traceability_id uuid unique references public.procedure_product_traceability(id) on delete restrict,
  draft_map_id uuid,
  draft_application_id uuid,
  original_path text not null,
  preview_path text not null,
  thumbnail_path text not null,
  mime_type text not null check (mime_type in ('image/jpeg','image/png')),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 18874368),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  source_type text not null check (source_type in ('camera','library','upload')),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  attached_at timestamptz,
  voided_at timestamptz,
  voided_by uuid references auth.users(id),
  void_reason text,
  constraint product_traceability_evidence_patient_owner_fkey
    foreign key (patient_id, user_id) references public.patients(id, user_id),
  constraint product_traceability_evidence_draft_shape_check check (
    (draft_map_id is null and draft_application_id is null)
    or
    (draft_map_id is not null and draft_application_id is not null)
  ),
  constraint product_traceability_evidence_attachment_check check (
    (traceability_id is null and attached_at is null)
    or
    (traceability_id is not null and attached_at is not null)
  ),
  constraint product_traceability_evidence_void_check check (
    voided_at is null or (voided_by is not null and length(btrim(coalesce(void_reason,''))) >= 3)
  ),
  unique (id, user_id)
);

create unique index if not exists product_traceability_evidence_active_draft_application_uidx
  on public.product_traceability_evidence(user_id, draft_map_id, draft_application_id)
  where traceability_id is null and voided_at is null and draft_map_id is not null;
create index if not exists product_traceability_evidence_patient_idx
  on public.product_traceability_evidence(user_id, patient_id, created_at desc);
create index if not exists product_traceability_evidence_traceability_idx
  on public.product_traceability_evidence(user_id, traceability_id)
  where traceability_id is not null;

alter table public.procedure_product_traceability enable row level security;
alter table public.product_traceability_evidence enable row level security;

revoke all on table public.procedure_product_traceability from anon, authenticated;
revoke all on table public.product_traceability_evidence from anon, authenticated;
grant select on table public.procedure_product_traceability to authenticated;
grant select on table public.product_traceability_evidence to authenticated;

create policy procedure_product_traceability_select_own_v1
  on public.procedure_product_traceability
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy product_traceability_evidence_select_own_v1
  on public.product_traceability_evidence
  for select to authenticated
  using (user_id = (select auth.uid()));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('product-evidence','product-evidence',false,20971520,array['image/jpeg','image/png']::text[])
on conflict (id) do nothing;

create policy product_evidence_insert_owned_draft_v1
  on storage.objects
  for insert to authenticated
  with check (
    bucket_id='product-evidence'
    and (storage.foldername(name))[1]=(select auth.uid())::text
    and (storage.foldername(name))[2]='patients'
    and (storage.foldername(name))[4]='product-evidence'
    and exists (
      select 1 from public.product_traceability_evidence e
      where e.user_id=(select auth.uid())
        and e.patient_id::text=(storage.foldername(objects.name))[3]
        and e.client_upload_id::text=(storage.foldername(objects.name))[5]
        and e.traceability_id is null
        and e.voided_at is null
        and objects.name in (e.original_path,e.preview_path,e.thumbnail_path)
    )
  );

create policy product_evidence_select_owned_v1
  on storage.objects
  for select to authenticated
  using (
    bucket_id='product-evidence'
    and (storage.foldername(name))[1]=(select auth.uid())::text
    and exists (
      select 1 from public.product_traceability_evidence e
      where e.user_id=(select auth.uid())
        and objects.name in (e.original_path,e.preview_path,e.thumbnail_path)
    )
  );

create policy product_evidence_delete_unattached_v1
  on storage.objects
  for delete to authenticated
  using (
    bucket_id='product-evidence'
    and (storage.foldername(name))[1]=(select auth.uid())::text
    and exists (
      select 1 from public.product_traceability_evidence e
      where e.user_id=(select auth.uid())
        and e.traceability_id is null
        and e.voided_at is null
        and objects.name in (e.original_path,e.preview_path,e.thumbnail_path)
    )
  );

create or replace function public.protect_product_traceability_history_v1()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if current_setting('hub.traceability_internal',true)='1' then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  raise exception using errcode='P0001', message='TRACEABILITY_IMMUTABLE';
end;
$$;

revoke all on function public.protect_product_traceability_history_v1() from public, anon, authenticated;

drop trigger if exists procedure_product_traceability_immutable_bud on public.procedure_product_traceability;
create trigger procedure_product_traceability_immutable_bud
before update or delete on public.procedure_product_traceability
for each row execute function public.protect_product_traceability_history_v1();

drop trigger if exists product_traceability_evidence_immutable_bud on public.product_traceability_evidence;
create trigger product_traceability_evidence_immutable_bud
before update or delete on public.product_traceability_evidence
for each row execute function public.protect_product_traceability_history_v1();

create or replace function public.create_product_traceability_evidence_draft_v1(
  p_upload_id uuid,
  p_patient_id uuid,
  p_source_type text,
  p_original_path text,
  p_preview_path text,
  p_thumbnail_path text,
  p_mime_type text,
  p_width integer,
  p_height integer,
  p_size_bytes bigint,
  p_sha256 text,
  p_draft_map_id uuid default null,
  p_draft_application_id uuid default null
)
returns public.product_traceability_evidence
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_ext text;
  v_root text;
  v_result public.product_traceability_evidence;
begin
  if v_user_id is null then raise exception using errcode='P0001',message='TRACEABILITY_SESSION_REQUIRED'; end if;
  if p_upload_id is null or p_patient_id is null then raise exception using errcode='22023',message='TRACEABILITY_UPLOAD_ARGUMENT_REQUIRED'; end if;
  if p_source_type not in ('camera','library','upload') then raise exception using errcode='22023',message='TRACEABILITY_SOURCE_INVALID'; end if;
  if p_mime_type not in ('image/jpeg','image/png') then raise exception using errcode='22023',message='TRACEABILITY_MIME_INVALID'; end if;
  if p_width is null or p_width<=0 or p_height is null or p_height<=0 or p_size_bytes is null or p_size_bytes<=0 or p_size_bytes>18874368 then raise exception using errcode='22023',message='TRACEABILITY_IMAGE_METADATA_INVALID'; end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception using errcode='22023',message='TRACEABILITY_SHA256_INVALID'; end if;
  if not exists(select 1 from public.patients p where p.id=p_patient_id and p.user_id=v_user_id) then raise exception using errcode='P0001',message='TRACEABILITY_PATIENT_FORBIDDEN'; end if;
  if (p_draft_map_id is null) <> (p_draft_application_id is null) then raise exception using errcode='22023',message='TRACEABILITY_DRAFT_LINK_INVALID'; end if;
  if p_draft_map_id is not null and not exists(select 1 from public.injectable_maps m where m.id=p_draft_map_id and m.user_id=v_user_id and m.patient_id=p_patient_id and m.status='draft') then raise exception using errcode='P0001',message='TRACEABILITY_DRAFT_FORBIDDEN'; end if;

  v_ext := case when p_mime_type='image/png' then 'png' else 'jpg' end;
  v_root := v_user_id::text||'/patients/'||p_patient_id::text||'/product-evidence/'||p_upload_id::text;
  if p_original_path is distinct from v_root||'/original.'||v_ext
     or p_preview_path is distinct from v_root||'/preview.'||v_ext
     or p_thumbnail_path is distinct from v_root||'/thumb.'||v_ext then
    raise exception using errcode='22023',message='TRACEABILITY_STORAGE_PATH_INVALID';
  end if;

  select * into v_result from public.product_traceability_evidence where id=p_upload_id and user_id=v_user_id;
  if found then
    if v_result.patient_id<>p_patient_id or v_result.sha256<>p_sha256 or v_result.original_path<>p_original_path then raise exception using errcode='P0001',message='TRACEABILITY_UPLOAD_IDEMPOTENCY_CONFLICT'; end if;
    return v_result;
  end if;

  insert into public.product_traceability_evidence(
    id,client_upload_id,user_id,patient_id,draft_map_id,draft_application_id,
    original_path,preview_path,thumbnail_path,mime_type,width,height,size_bytes,sha256,source_type,created_by
  ) values (
    p_upload_id,p_upload_id,v_user_id,p_patient_id,p_draft_map_id,p_draft_application_id,
    p_original_path,p_preview_path,p_thumbnail_path,p_mime_type,p_width,p_height,p_size_bytes,p_sha256,p_source_type,v_user_id
  ) returning * into v_result;
  return v_result;
end;
$$;

revoke all on function public.create_product_traceability_evidence_draft_v1(uuid,uuid,text,text,text,text,text,integer,integer,bigint,text,uuid,uuid) from public, anon;
grant execute on function public.create_product_traceability_evidence_draft_v1(uuid,uuid,text,text,text,text,text,integer,integer,bigint,text,uuid,uuid) to authenticated;

create or replace function public.discard_product_traceability_evidence_draft_v1(p_upload_id uuid)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception using errcode='P0001',message='TRACEABILITY_SESSION_REQUIRED'; end if;
  perform set_config('hub.traceability_internal','1',true);
  delete from public.product_traceability_evidence
  where id=p_upload_id and user_id=v_user_id and traceability_id is null and voided_at is null;
  if not found then raise exception using errcode='P0001',message='TRACEABILITY_DRAFT_NOT_DISCARDABLE'; end if;
end;
$$;
revoke all on function public.discard_product_traceability_evidence_draft_v1(uuid) from public, anon;
grant execute on function public.discard_product_traceability_evidence_draft_v1(uuid) to authenticated;

create or replace function public.attach_product_traceability_evidence_internal_v1(
  p_traceability_id uuid,
  p_evidence_id uuid,
  p_patient_id uuid
)
returns void
language plpgsql
security definer
set search_path=public,storage,pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_evidence public.product_traceability_evidence;
  v_object_count integer;
begin
  if v_user_id is null then raise exception using errcode='P0001',message='TRACEABILITY_SESSION_REQUIRED'; end if;
  select * into v_evidence from public.product_traceability_evidence e
  where e.id=p_evidence_id and e.user_id=v_user_id for update;
  if not found then raise exception using errcode='P0001',message='TRACEABILITY_EVIDENCE_FORBIDDEN'; end if;
  if v_evidence.patient_id<>p_patient_id then raise exception using errcode='P0001',message='TRACEABILITY_EVIDENCE_PATIENT_MISMATCH'; end if;
  if v_evidence.voided_at is not null then raise exception using errcode='P0001',message='TRACEABILITY_EVIDENCE_VOIDED'; end if;
  if v_evidence.traceability_id is not null then
    if v_evidence.traceability_id=p_traceability_id then return; end if;
    raise exception using errcode='P0001',message='TRACEABILITY_EVIDENCE_ALREADY_ATTACHED';
  end if;

  select count(*) into v_object_count from storage.objects o
  where o.bucket_id='product-evidence' and o.name in (v_evidence.original_path,v_evidence.preview_path,v_evidence.thumbnail_path);
  if v_object_count<>3 then raise exception using errcode='P0001',message='TRACEABILITY_EVIDENCE_UPLOAD_INCOMPLETE'; end if;

  perform set_config('hub.traceability_internal','1',true);
  update public.product_traceability_evidence
  set traceability_id=p_traceability_id,attached_at=now()
  where id=p_evidence_id and user_id=v_user_id;
end;
$$;
revoke all on function public.attach_product_traceability_evidence_internal_v1(uuid,uuid,uuid) from public, anon, authenticated;

create or replace function public.finalize_product_traceability_internal_v1(
  p_procedure_id uuid,
  p_materials jsonb,
  p_injectable_map_id uuid default null
)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_procedure public.procedures;
  v_input record;
  v_material public.materials;
  v_pm public.procedure_materials;
  v_trace_id uuid;
  v_lot text;
  v_expires date;
  v_evidence_id uuid;
  v_app public.injectable_applications;
  v_product_mode text;
begin
  if v_user_id is null then raise exception using errcode='P0001',message='TRACEABILITY_SESSION_REQUIRED'; end if;
  select * into v_procedure from public.procedures p where p.id=p_procedure_id and p.user_id=v_user_id;
  if not found then raise exception using errcode='P0001',message='TRACEABILITY_PROCEDURE_FORBIDDEN'; end if;

  if jsonb_typeof(coalesce(p_materials,'[]'::jsonb))<>'array' then raise exception using errcode='22023',message='ATTENDANCE_MATERIALS_INVALID'; end if;
  for v_input in
    select m.material_id,m.quantity,m.traceability
    from jsonb_to_recordset(coalesce(p_materials,'[]'::jsonb)) as m(material_id uuid,quantity numeric,traceability jsonb)
  loop
    select * into v_material from public.materials where id=v_input.material_id and user_id=v_user_id;
    if not found then raise exception using errcode='P0001',message='MATERIAL_FORBIDDEN'; end if;
    select * into v_pm from public.procedure_materials where procedure_id=p_procedure_id and material_id=v_input.material_id and user_id=v_user_id;
    if not found then raise exception using errcode='P0001',message='TRACEABILITY_PROCEDURE_MATERIAL_MISSING'; end if;

    if v_input.traceability is not null and jsonb_typeof(v_input.traceability)<>'object' then raise exception using errcode='22023',message='MATERIAL_TRACEABILITY_INVALID'; end if;
    if v_material.traceability_mode='none' then
      if coalesce(v_input.traceability,'{}'::jsonb)<>'{}'::jsonb then raise exception using errcode='P0001',message='MATERIAL_TRACEABILITY_DISABLED'; end if;
      continue;
    end if;

    v_lot := nullif(btrim(coalesce(v_input.traceability->>'lot_number','')),'');
    begin v_expires := nullif(v_input.traceability->>'expires_on','')::date;
    exception when invalid_datetime_format then raise exception using errcode='22023',message='MATERIAL_TRACEABILITY_EXPIRY_INVALID'; end;
    begin v_evidence_id := nullif(v_input.traceability->>'evidence_upload_id','')::uuid;
    exception when invalid_text_representation then raise exception using errcode='22023',message='TRACEABILITY_EVIDENCE_ID_INVALID'; end;

    insert into public.procedure_product_traceability(
      user_id,patient_id,procedure_id,procedure_id_snapshot,performed_at_snapshot,
      source_kind,source_ref_snapshot,procedure_material_id,material_id,product_ref_snapshot,
      product_name_snapshot,brand_snapshot,presentation_snapshot,lot_number_snapshot,expires_on_snapshot,
      quantity_snapshot,unit_snapshot,traceability_mode_snapshot,created_by
    ) values (
      v_user_id,v_procedure.patient_id,v_procedure.id,v_procedure.id,v_procedure.performed_at,
      'procedure_material',v_pm.id,v_pm.id,v_material.id,v_material.id,
      v_pm.material_name_snapshot,null,null,v_lot,v_expires,
      v_pm.quantity,v_pm.unit_label_snapshot,v_material.traceability_mode,v_user_id
    )
    on conflict (user_id,procedure_id_snapshot,source_kind,source_ref_snapshot) do nothing
    returning id into v_trace_id;
    if v_trace_id is null then
      select id into v_trace_id from public.procedure_product_traceability
      where user_id=v_user_id and procedure_id_snapshot=v_procedure.id and source_kind='procedure_material' and source_ref_snapshot=v_pm.id;
    end if;
    if v_evidence_id is not null then perform public.attach_product_traceability_evidence_internal_v1(v_trace_id,v_evidence_id,v_procedure.patient_id); end if;
  end loop;

  if p_injectable_map_id is not null then
    for v_app in
      select * from public.injectable_applications a
      where a.map_id=p_injectable_map_id and a.user_id=v_user_id
      order by a.created_at,a.id
    loop
      select coalesce(ip.traceability_mode,'recommended') into v_product_mode
      from public.injectable_products ip where ip.id=v_app.product_id and ip.user_id=v_user_id;
      v_product_mode := coalesce(v_product_mode,'recommended');
      if v_product_mode='none' then continue; end if;

      v_trace_id := null;
      insert into public.procedure_product_traceability(
        user_id,patient_id,procedure_id,procedure_id_snapshot,performed_at_snapshot,
        source_kind,source_ref_snapshot,injectable_application_id,injectable_product_id,product_ref_snapshot,
        product_name_snapshot,brand_snapshot,presentation_snapshot,lot_number_snapshot,expires_on_snapshot,
        quantity_snapshot,unit_snapshot,traceability_mode_snapshot,created_by
      ) values (
        v_user_id,v_procedure.patient_id,v_procedure.id,v_procedure.id,v_procedure.performed_at,
        'injectable_application',v_app.id,v_app.id,v_app.product_id,v_app.product_id,
        v_app.product_name_snapshot,v_app.product_brand_snapshot,v_app.product_presentation_snapshot,v_app.lot_number_snapshot,v_app.expires_on_snapshot,
        v_app.total_quantity_snapshot,v_app.unit_snapshot,v_product_mode,v_user_id
      )
      on conflict (user_id,procedure_id_snapshot,source_kind,source_ref_snapshot) do nothing
      returning id into v_trace_id;
      if v_trace_id is null then
        select id into v_trace_id from public.procedure_product_traceability
        where user_id=v_user_id and procedure_id_snapshot=v_procedure.id and source_kind='injectable_application' and source_ref_snapshot=v_app.id;
      end if;

      select e.id into v_evidence_id
      from public.product_traceability_evidence e
      where e.user_id=v_user_id and e.patient_id=v_procedure.patient_id
        and e.draft_map_id=p_injectable_map_id and e.draft_application_id=v_app.id
        and e.traceability_id is null and e.voided_at is null
      order by e.created_at desc limit 1;
      if found then perform public.attach_product_traceability_evidence_internal_v1(v_trace_id,v_evidence_id,v_procedure.patient_id); end if;
    end loop;
  end if;
end;
$$;
revoke all on function public.finalize_product_traceability_internal_v1(uuid,jsonb,uuid) from public, anon, authenticated;

create or replace function public.create_material_v2(
  p_idempotency_key uuid,
  p_name text,
  p_unit_label text,
  p_unit_cost numeric,
  p_initial_stock numeric,
  p_minimum_stock numeric,
  p_active boolean,
  p_traceability_mode text
)
returns public.materials
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_key text;
  v_hash text;
  v_material_id uuid := gen_random_uuid();
  v_existing_material_id uuid;
  v_existing_hash text;
  v_result public.materials;
  v_mode text := coalesce(nullif(btrim(p_traceability_mode),''),'none');
begin
  if v_user_id is null then raise exception using errcode='P0001',message='MATERIAL_SESSION_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception using errcode='22023',message='INVENTORY_IDEMPOTENCY_KEY_REQUIRED'; end if;
  if btrim(coalesce(p_name,''))='' then raise exception using errcode='22023',message='MATERIAL_NAME_REQUIRED'; end if;
  if btrim(coalesce(p_unit_label,''))='' then raise exception using errcode='22023',message='MATERIAL_UNIT_REQUIRED'; end if;
  if p_unit_cost is null or p_unit_cost<0 then raise exception using errcode='22023',message='MATERIAL_UNIT_COST_INVALID'; end if;
  if coalesce(p_initial_stock,0)<0 or coalesce(p_minimum_stock,0)<0 then raise exception using errcode='22023',message='MATERIAL_STOCK_INVALID'; end if;
  if v_mode not in ('none','optional','recommended') then raise exception using errcode='22023',message='MATERIAL_TRACEABILITY_MODE_INVALID'; end if;

  v_key := 'material-create:'||p_idempotency_key::text;
  v_hash := md5(jsonb_build_object('v',2,'name',btrim(p_name),'unit_label',btrim(p_unit_label),'unit_cost',round(p_unit_cost,4),'initial_stock',round(coalesce(p_initial_stock,0),3),'minimum_stock',round(coalesce(p_minimum_stock,0),3),'active',coalesce(p_active,true),'traceability_mode',v_mode)::text);
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text||':'||v_key,0));
  select material_id,idempotency_payload_hash into v_existing_material_id,v_existing_hash from public.inventory_movements where user_id=v_user_id and idempotency_key=v_key;
  if found then
    if v_existing_hash is distinct from v_hash then raise exception using errcode='P0001',message='INVENTORY_IDEMPOTENCY_CONFLICT'; end if;
    select * into v_result from public.materials where id=v_existing_material_id and user_id=v_user_id;
    return v_result;
  end if;

  perform set_config('hub.inventory_mutation_context',jsonb_build_object('material_id',v_material_id,'movement_type','initial_stock','expected_delta',round(coalesce(p_initial_stock,0),3),'unit_cost_snapshot',round(p_unit_cost,4),'reason','Estoque inicial','idempotency_key',v_key,'idempotency_payload_hash',v_hash)::text,true);
  insert into public.materials(id,user_id,name,unit_label,unit_cost,stock_quantity,minimum_stock,active,traceability_mode)
  values(v_material_id,v_user_id,btrim(p_name),btrim(p_unit_label),round(p_unit_cost,4),round(coalesce(p_initial_stock,0),3),round(coalesce(p_minimum_stock,0),3),coalesce(p_active,true),v_mode)
  returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.update_material_v2(
  p_material_id uuid,
  p_name text,
  p_unit_label text,
  p_unit_cost numeric,
  p_minimum_stock numeric,
  p_active boolean,
  p_traceability_mode text
)
returns public.materials
language plpgsql
set search_path=public,pg_temp
as $$
declare v_user_id uuid := auth.uid(); v_result public.materials; v_mode text := coalesce(nullif(btrim(p_traceability_mode),''),'none');
begin
  if v_user_id is null then raise exception using errcode='P0001',message='MATERIAL_SESSION_REQUIRED'; end if;
  if p_material_id is null then raise exception using errcode='22023',message='MATERIAL_REQUIRED'; end if;
  if btrim(coalesce(p_name,''))='' then raise exception using errcode='22023',message='MATERIAL_NAME_REQUIRED'; end if;
  if btrim(coalesce(p_unit_label,''))='' then raise exception using errcode='22023',message='MATERIAL_UNIT_REQUIRED'; end if;
  if p_unit_cost is null or p_unit_cost<0 or p_minimum_stock is null or p_minimum_stock<0 then raise exception using errcode='22023',message='MATERIAL_VALUE_INVALID'; end if;
  if v_mode not in ('none','optional','recommended') then raise exception using errcode='22023',message='MATERIAL_TRACEABILITY_MODE_INVALID'; end if;
  update public.materials set name=btrim(p_name),unit_label=btrim(p_unit_label),unit_cost=round(p_unit_cost,4),minimum_stock=round(p_minimum_stock,3),active=coalesce(p_active,true),traceability_mode=v_mode
  where id=p_material_id and user_id=v_user_id returning * into v_result;
  if not found then raise exception using errcode='P0001',message='MATERIAL_FORBIDDEN'; end if;
  return v_result;
end;
$$;

revoke all on function public.create_material_v2(uuid,text,text,numeric,numeric,numeric,boolean,text) from public, anon;
grant execute on function public.create_material_v2(uuid,text,text,numeric,numeric,numeric,boolean,text) to authenticated;
revoke all on function public.update_material_v2(uuid,text,text,numeric,numeric,boolean,text) from public, anon;
grant execute on function public.update_material_v2(uuid,text,text,numeric,numeric,boolean,text) to authenticated;

create or replace function public.create_procedure_v5(
  p_idempotency_key uuid,
  p_patient_id uuid,
  p_appointment_id uuid,
  p_performed_at timestamptz,
  p_items jsonb,
  p_payment_entries jsonb,
  p_injectable_maps jsonb,
  p_coverages jsonb,
  p_materials jsonb,
  p_notes text
)
returns public.procedures
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_materials jsonb := coalesce(p_materials,'[]'::jsonb);
  v_materials_canonical jsonb;
  v_materials_base jsonb;
  v_hash text;
  v_existing public.procedures;
  v_result public.procedures;
  v_count integer;
begin
  if v_user_id is null then raise exception using errcode='P0001',message='ATTENDANCE_SESSION_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception using errcode='22023',message='ATTENDANCE_IDEMPOTENCY_KEY_REQUIRED'; end if;
  if jsonb_typeof(v_materials)<>'array' then raise exception using errcode='22023',message='ATTENDANCE_MATERIALS_INVALID'; end if;
  if exists(select 1 from jsonb_to_recordset(v_materials) as m(material_id uuid,quantity numeric,traceability jsonb) where m.material_id is null or m.quantity is null or m.quantity<=0 or (m.traceability is not null and jsonb_typeof(m.traceability)<>'object')) then raise exception using errcode='22023',message='ATTENDANCE_MATERIAL_INVALID'; end if;
  select count(*) into v_count from jsonb_to_recordset(v_materials) as m(material_id uuid,quantity numeric,traceability jsonb);
  if (select count(distinct m.material_id) from jsonb_to_recordset(v_materials) as m(material_id uuid,quantity numeric,traceability jsonb))<>v_count then raise exception using errcode='22023',message='ATTENDANCE_DUPLICATE_MATERIAL'; end if;

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('material_id',m.material_id,'quantity',round(m.quantity,3),'traceability',case when coalesce(m.traceability,'{}'::jsonb)='{}'::jsonb then null else jsonb_strip_nulls(jsonb_build_object('lot_number',nullif(btrim(m.traceability->>'lot_number'),''),'expires_on',nullif(m.traceability->>'expires_on',''),'evidence_upload_id',nullif(m.traceability->>'evidence_upload_id',''))) end)) order by m.material_id),'[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('material_id',m.material_id,'quantity',round(m.quantity,3)) order by m.material_id),'[]'::jsonb)
  into v_materials_canonical,v_materials_base
  from jsonb_to_recordset(v_materials) as m(material_id uuid,quantity numeric,traceability jsonb);

  v_hash := md5(jsonb_build_object('v',5,'patient_id',p_patient_id,'appointment_id',p_appointment_id,'performed_at',p_performed_at,'items',p_items,'payment_entries',coalesce(p_payment_entries,'[]'::jsonb),'injectable_maps',coalesce(p_injectable_maps,'[]'::jsonb),'coverages',coalesce(p_coverages,'[]'::jsonb),'materials',v_materials_canonical,'notes',p_notes)::text);
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text||':'||p_idempotency_key::text,0));
  select * into v_existing from public.procedures where user_id=v_user_id and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.idempotency_payload_hash<>v_hash then raise exception using errcode='P0001',message='ATTENDANCE_IDEMPOTENCY_CONFLICT'; end if;
    return v_existing;
  end if;

  select * into v_result from public.create_procedure_v4(p_idempotency_key,p_patient_id,p_appointment_id,p_performed_at,p_items,coalesce(p_payment_entries,'[]'::jsonb),coalesce(p_injectable_maps,'[]'::jsonb),coalesce(p_coverages,'[]'::jsonb),v_materials_base,p_notes);
  perform public.finalize_product_traceability_internal_v1(v_result.id,v_materials_canonical,null);
  update public.procedures set idempotency_payload_hash=v_hash where id=v_result.id and user_id=v_user_id returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.create_procedure_with_injectable_draft_v5(
  p_idempotency_key uuid,
  p_patient_id uuid,
  p_appointment_id uuid,
  p_performed_at timestamptz,
  p_items jsonb,
  p_payment_entries jsonb,
  p_coverages jsonb,
  p_materials jsonb,
  p_notes text,
  p_draft_id uuid,
  p_draft_revision bigint
)
returns public.procedures
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_materials jsonb := coalesce(p_materials,'[]'::jsonb);
  v_materials_canonical jsonb;
  v_materials_base jsonb;
  v_evidence_fingerprint jsonb;
  v_hash text;
  v_existing public.procedures;
  v_result public.procedures;
  v_count integer;
begin
  if v_user_id is null then raise exception using errcode='P0001',message='ATTENDANCE_SESSION_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception using errcode='22023',message='ATTENDANCE_IDEMPOTENCY_KEY_REQUIRED'; end if;
  if p_draft_id is null or p_draft_revision is null then raise exception using errcode='22023',message='ATTENDANCE_INJECTABLE_DRAFT_REQUIRED'; end if;
  if jsonb_typeof(v_materials)<>'array' then raise exception using errcode='22023',message='ATTENDANCE_MATERIALS_INVALID'; end if;
  if exists(select 1 from jsonb_to_recordset(v_materials) as m(material_id uuid,quantity numeric,traceability jsonb) where m.material_id is null or m.quantity is null or m.quantity<=0 or (m.traceability is not null and jsonb_typeof(m.traceability)<>'object')) then raise exception using errcode='22023',message='ATTENDANCE_MATERIAL_INVALID'; end if;
  select count(*) into v_count from jsonb_to_recordset(v_materials) as m(material_id uuid,quantity numeric,traceability jsonb);
  if (select count(distinct m.material_id) from jsonb_to_recordset(v_materials) as m(material_id uuid,quantity numeric,traceability jsonb))<>v_count then raise exception using errcode='22023',message='ATTENDANCE_DUPLICATE_MATERIAL'; end if;

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('material_id',m.material_id,'quantity',round(m.quantity,3),'traceability',case when coalesce(m.traceability,'{}'::jsonb)='{}'::jsonb then null else jsonb_strip_nulls(jsonb_build_object('lot_number',nullif(btrim(m.traceability->>'lot_number'),''),'expires_on',nullif(m.traceability->>'expires_on',''),'evidence_upload_id',nullif(m.traceability->>'evidence_upload_id',''))) end)) order by m.material_id),'[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('material_id',m.material_id,'quantity',round(m.quantity,3)) order by m.material_id),'[]'::jsonb)
  into v_materials_canonical,v_materials_base
  from jsonb_to_recordset(v_materials) as m(material_id uuid,quantity numeric,traceability jsonb);

  select coalesce(jsonb_agg(jsonb_build_object('application_id',e.draft_application_id,'evidence_id',e.id,'sha256',e.sha256) order by e.draft_application_id),'[]'::jsonb)
  into v_evidence_fingerprint
  from public.product_traceability_evidence e
  where e.user_id=v_user_id and e.patient_id=p_patient_id and e.draft_map_id=p_draft_id and e.traceability_id is null and e.voided_at is null;

  v_hash := md5(jsonb_build_object('v',5,'mode','injectable_draft','patient_id',p_patient_id,'appointment_id',p_appointment_id,'performed_at',p_performed_at,'items',p_items,'payment_entries',coalesce(p_payment_entries,'[]'::jsonb),'coverages',coalesce(p_coverages,'[]'::jsonb),'materials',v_materials_canonical,'notes',p_notes,'draft_id',p_draft_id,'draft_revision',p_draft_revision,'evidence',v_evidence_fingerprint)::text);
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text||':'||p_idempotency_key::text,0));
  select * into v_existing from public.procedures where user_id=v_user_id and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.idempotency_payload_hash<>v_hash then raise exception using errcode='P0001',message='ATTENDANCE_IDEMPOTENCY_CONFLICT'; end if;
    return v_existing;
  end if;

  select * into v_result from public.create_procedure_with_injectable_draft_v4(p_idempotency_key,p_patient_id,p_appointment_id,p_performed_at,p_items,coalesce(p_payment_entries,'[]'::jsonb),coalesce(p_coverages,'[]'::jsonb),v_materials_base,p_notes,p_draft_id,p_draft_revision);
  perform public.finalize_product_traceability_internal_v1(v_result.id,v_materials_canonical,p_draft_id);
  update public.procedures set idempotency_payload_hash=v_hash where id=v_result.id and user_id=v_user_id returning * into v_result;
  return v_result;
end;
$$;

revoke all on function public.create_procedure_v5(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb,text) from public, anon;
grant execute on function public.create_procedure_v5(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb,text) to authenticated;
revoke all on function public.create_procedure_with_injectable_draft_v5(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,text,uuid,bigint) from public, anon;
grant execute on function public.create_procedure_with_injectable_draft_v5(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,text,uuid,bigint) to authenticated;

create or replace function public.mark_product_traceability_reverted_before_procedure_delete_v1()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  perform set_config('hub.traceability_internal','1',true);
  update public.procedure_product_traceability
  set status=case when status='active' then 'reverted' else status end,
      procedure_reverted_at=coalesce(procedure_reverted_at,now())
  where user_id=old.user_id and procedure_id_snapshot=old.id;
  return old;
end;
$$;
revoke all on function public.mark_product_traceability_reverted_before_procedure_delete_v1() from public, anon, authenticated;

drop trigger if exists procedures_mark_product_traceability_reverted_bd on public.procedures;
create trigger procedures_mark_product_traceability_reverted_bd
before delete on public.procedures
for each row execute function public.mark_product_traceability_reverted_before_procedure_delete_v1();

create or replace function public.void_product_traceability_v1(p_traceability_id uuid,p_reason text)
returns public.procedure_product_traceability
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_user_id uuid:=auth.uid(); v_result public.procedure_product_traceability;
begin
  if v_user_id is null then raise exception using errcode='P0001',message='TRACEABILITY_SESSION_REQUIRED'; end if;
  if length(btrim(coalesce(p_reason,'')))<3 then raise exception using errcode='22023',message='TRACEABILITY_VOID_REASON_REQUIRED'; end if;
  perform set_config('hub.traceability_internal','1',true);
  update public.procedure_product_traceability set status='voided',voided_at=now(),voided_by=v_user_id,void_reason=btrim(p_reason)
  where id=p_traceability_id and user_id=v_user_id and status<>'voided' returning * into v_result;
  if not found then raise exception using errcode='P0001',message='TRACEABILITY_NOT_VOIDABLE'; end if;
  return v_result;
end;
$$;
revoke all on function public.void_product_traceability_v1(uuid,text) from public, anon;
grant execute on function public.void_product_traceability_v1(uuid,text) to authenticated;

create or replace function public.list_product_traceability_by_lot_v1(
  p_lot text,
  p_product_ref uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table(
  traceability_id uuid,
  patient_id uuid,
  patient_name text,
  procedure_id uuid,
  procedure_id_snapshot uuid,
  performed_at timestamptz,
  source_kind text,
  product_name text,
  lot_number text,
  expires_on date,
  quantity numeric,
  unit text,
  status text,
  evidence_count bigint
)
language sql
stable
set search_path=public,pg_temp
as $$
  select t.id,t.patient_id,p.name,t.procedure_id,t.procedure_id_snapshot,t.performed_at_snapshot,
         t.source_kind,t.product_name_snapshot,t.lot_number_snapshot,t.expires_on_snapshot,
         t.quantity_snapshot,t.unit_snapshot,t.status,
         (select count(*) from public.product_traceability_evidence e where e.traceability_id=t.id and e.user_id=t.user_id and e.voided_at is null)
  from public.procedure_product_traceability t
  join public.patients p on p.id=t.patient_id and p.user_id=t.user_id
  where t.user_id=(select auth.uid())
    and nullif(btrim(p_lot),'') is not null
    and lower(btrim(t.lot_number_snapshot))=lower(btrim(p_lot))
    and (p_product_ref is null or t.product_ref_snapshot=p_product_ref)
    and (p_from is null or t.performed_at_snapshot>=p_from)
    and (p_to is null or t.performed_at_snapshot<=p_to)
  order by t.performed_at_snapshot desc,t.id;
$$;
revoke all on function public.list_product_traceability_by_lot_v1(text,uuid,timestamptz,timestamptz) from public, anon;
grant execute on function public.list_product_traceability_by_lot_v1(text,uuid,timestamptz,timestamptz) to authenticated;
