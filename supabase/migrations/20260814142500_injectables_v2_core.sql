-- Hub Giulia 2.3 — Injetáveis 2.0
-- Structured clinical record for injectable applications.
-- Legacy injectable_maps.points is preserved verbatim and remains readable.

-- -----------------------------------------------------------------------------
-- Map header: add lifecycle/version metadata without rewriting legacy points.
-- Defaults intentionally keep old callers backward-compatible: the existing
-- create_procedure_v2 still inserts a finalized legacy map when it only supplies
-- procedure/patient/user/points.
-- -----------------------------------------------------------------------------

alter table public.injectable_maps
  add column if not exists status text,
  add column if not exists source_type text,
  add column if not exists record_schema_version integer,
  add column if not exists map_type text,
  add column if not exists map_schema_version integer,
  add column if not exists background_version text,
  add column if not exists revision bigint,
  add column if not exists updated_at timestamptz,
  add column if not exists finalized_at timestamptz,
  add column if not exists voided_at timestamptz,
  add column if not exists finalization_key uuid;

update public.injectable_maps
set
  status = coalesce(status, 'finalized'),
  source_type = coalesce(source_type, 'legacy'),
  record_schema_version = coalesce(record_schema_version, 1),
  map_type = coalesce(map_type, 'face'),
  map_schema_version = coalesce(map_schema_version, 1),
  background_version = coalesce(background_version, 'face-botox-v1'),
  revision = coalesce(revision, 1),
  updated_at = coalesce(updated_at, created_at),
  finalized_at = coalesce(finalized_at, created_at)
where status is null
   or source_type is null
   or record_schema_version is null
   or map_type is null
   or map_schema_version is null
   or background_version is null
   or revision is null
   or updated_at is null
   or finalized_at is null;

alter table public.injectable_maps
  alter column status set default 'finalized',
  alter column status set not null,
  alter column source_type set default 'legacy',
  alter column source_type set not null,
  alter column record_schema_version set default 1,
  alter column record_schema_version set not null,
  alter column map_type set default 'face',
  alter column map_type set not null,
  alter column map_schema_version set default 1,
  alter column map_schema_version set not null,
  alter column background_version set default 'face-botox-v1',
  alter column background_version set not null,
  alter column revision set default 1,
  alter column revision set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'injectable_maps_status_check'
      and conrelid = 'public.injectable_maps'::regclass
  ) then
    alter table public.injectable_maps
      add constraint injectable_maps_status_check
      check (status in ('draft', 'finalized', 'voided'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'injectable_maps_source_type_check'
      and conrelid = 'public.injectable_maps'::regclass
  ) then
    alter table public.injectable_maps
      add constraint injectable_maps_source_type_check
      check (source_type in ('legacy', 'v2'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'injectable_maps_record_schema_version_check'
      and conrelid = 'public.injectable_maps'::regclass
  ) then
    alter table public.injectable_maps
      add constraint injectable_maps_record_schema_version_check
      check (record_schema_version >= 1);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'injectable_maps_map_schema_version_check'
      and conrelid = 'public.injectable_maps'::regclass
  ) then
    alter table public.injectable_maps
      add constraint injectable_maps_map_schema_version_check
      check (map_schema_version >= 1);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'injectable_maps_revision_check'
      and conrelid = 'public.injectable_maps'::regclass
  ) then
    alter table public.injectable_maps
      add constraint injectable_maps_revision_check
      check (revision >= 1);
  end if;
end $$;

create unique index if not exists injectable_maps_id_user_id_uidx
  on public.injectable_maps (id, user_id);

create unique index if not exists injectable_maps_user_finalization_key_uidx
  on public.injectable_maps (user_id, finalization_key)
  where finalization_key is not null;

-- One recoverable face draft per patient/user. Finalized sessions are unlimited.
create unique index if not exists injectable_maps_one_open_v2_draft_uidx
  on public.injectable_maps (user_id, patient_id, map_type)
  where status = 'draft' and source_type = 'v2' and procedure_id is null;

-- -----------------------------------------------------------------------------
-- Catalog: configurable products and lots. These are current configuration only;
-- historical records use snapshots in injectable_applications.
-- -----------------------------------------------------------------------------

create table if not exists public.injectable_products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  category text,
  brand text,
  substance text,
  default_unit text not null,
  presentation text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint injectable_products_name_check check (length(btrim(name)) > 0),
  constraint injectable_products_unit_check check (length(btrim(default_unit)) > 0)
);

create unique index if not exists injectable_products_id_user_id_uidx
  on public.injectable_products (id, user_id);

create index if not exists injectable_products_user_active_name_idx
  on public.injectable_products (user_id, active, name);

create table if not exists public.injectable_product_lots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_id uuid not null,
  lot_number text not null,
  expires_on date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint injectable_product_lots_number_check check (length(btrim(lot_number)) > 0),
  constraint injectable_product_lots_product_owner_fkey
    foreign key (product_id, user_id)
    references public.injectable_products(id, user_id)
    on delete restrict
);

create unique index if not exists injectable_product_lots_id_user_id_uidx
  on public.injectable_product_lots (id, user_id);

create index if not exists injectable_product_lots_user_product_idx
  on public.injectable_product_lots (user_id, product_id, active, expires_on);

-- -----------------------------------------------------------------------------
-- Historical application: one product/unit/lot snapshot within one anatomical map.
-- -----------------------------------------------------------------------------

create table if not exists public.injectable_applications (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  service_id uuid not null,
  procedure_item_id uuid,
  product_id uuid not null,
  lot_id uuid,
  service_name_snapshot text not null,
  product_name_snapshot text not null,
  product_category_snapshot text,
  product_brand_snapshot text,
  product_substance_snapshot text,
  product_presentation_snapshot text,
  unit_snapshot text not null,
  lot_number_snapshot text,
  expires_on_snapshot date,
  color_snapshot text not null default '#be185d',
  dilution_note text,
  total_quantity_snapshot numeric(14,4),
  created_at timestamptz not null default now(),
  constraint injectable_applications_map_owner_fkey
    foreign key (map_id, user_id)
    references public.injectable_maps(id, user_id)
    on delete cascade,
  constraint injectable_applications_service_owner_fkey
    foreign key (service_id, user_id)
    references public.services(id, user_id)
    on delete restrict,
  constraint injectable_applications_item_owner_fkey
    foreign key (procedure_item_id, user_id)
    references public.procedure_items(id, user_id)
    on delete restrict,
  constraint injectable_applications_product_owner_fkey
    foreign key (product_id, user_id)
    references public.injectable_products(id, user_id)
    on delete restrict,
  constraint injectable_applications_lot_owner_fkey
    foreign key (lot_id, user_id)
    references public.injectable_product_lots(id, user_id)
    on delete restrict,
  constraint injectable_applications_service_snapshot_check check (length(btrim(service_name_snapshot)) > 0),
  constraint injectable_applications_product_snapshot_check check (length(btrim(product_name_snapshot)) > 0),
  constraint injectable_applications_unit_snapshot_check check (length(btrim(unit_snapshot)) > 0),
  constraint injectable_applications_total_check check (total_quantity_snapshot is null or total_quantity_snapshot > 0)
);

create unique index if not exists injectable_applications_id_user_id_uidx
  on public.injectable_applications (id, user_id);

create unique index if not exists injectable_applications_id_map_user_uidx
  on public.injectable_applications (id, map_id, user_id);

create index if not exists injectable_applications_map_idx
  on public.injectable_applications (user_id, map_id, created_at);

create index if not exists injectable_applications_procedure_item_idx
  on public.injectable_applications (user_id, procedure_item_id)
  where procedure_item_id is not null;

create table if not exists public.injectable_application_points (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null,
  map_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  x numeric(12,10) not null,
  y numeric(12,10) not null,
  quantity numeric(14,4) not null,
  unit_snapshot text not null,
  region text,
  side text,
  note text,
  created_at timestamptz not null default now(),
  constraint injectable_application_points_application_map_owner_fkey
    foreign key (application_id, map_id, user_id)
    references public.injectable_applications(id, map_id, user_id)
    on delete cascade,
  constraint injectable_application_points_map_owner_fkey
    foreign key (map_id, user_id)
    references public.injectable_maps(id, user_id)
    on delete cascade,
  constraint injectable_application_points_x_check check (x >= 0 and x <= 1),
  constraint injectable_application_points_y_check check (y >= 0 and y <= 1),
  constraint injectable_application_points_quantity_check check (quantity > 0),
  constraint injectable_application_points_unit_check check (length(btrim(unit_snapshot)) > 0),
  constraint injectable_application_points_side_check check (side is null or side in ('left', 'right', 'center', 'none'))
);

create unique index if not exists injectable_application_points_id_user_id_uidx
  on public.injectable_application_points (id, user_id);

create index if not exists injectable_application_points_application_idx
  on public.injectable_application_points (user_id, application_id, created_at);

create index if not exists injectable_application_points_map_idx
  on public.injectable_application_points (user_id, map_id, created_at);

-- -----------------------------------------------------------------------------
-- Lifecycle guards. Drafts are mutable; finalized/voided clinical history is not.
-- Finalization is performed only by the dedicated RPC, which sets a transaction-
-- local flag after ownership and consistency validation.
-- -----------------------------------------------------------------------------

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

  if old.status <> 'draft' then
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

  if new.status <> 'draft'
     and coalesce(current_setting('hub.injectable_finalizing', true), '') <> '1' then
    raise exception using errcode = 'P0001', message = 'INJECTABLE_FINALIZE_RPC_REQUIRED';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_injectable_map_history_v2() from public, anon, authenticated;

drop trigger if exists injectable_maps_history_guard_v2 on public.injectable_maps;
create trigger injectable_maps_history_guard_v2
before update or delete on public.injectable_maps
for each row execute function public.guard_injectable_map_history_v2();

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

  -- A missing parent is only expected while an explicit draft parent delete is
  -- cascading. Foreign keys prevent ordinary orphan creation.
  if v_status is null and tg_op = 'DELETE' then
    return old;
  end if;

  if v_status is distinct from 'draft' then
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

revoke all on function public.guard_injectable_child_history_v2() from public, anon, authenticated;

drop trigger if exists injectable_applications_history_guard_v2 on public.injectable_applications;
create trigger injectable_applications_history_guard_v2
before insert or update or delete on public.injectable_applications
for each row execute function public.guard_injectable_child_history_v2();

drop trigger if exists injectable_application_points_history_guard_v2 on public.injectable_application_points;
create trigger injectable_application_points_history_guard_v2
before insert or update or delete on public.injectable_application_points
for each row execute function public.guard_injectable_child_history_v2();

create or replace function public.touch_injectable_catalog_updated_at_v2()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.touch_injectable_catalog_updated_at_v2() from public, anon, authenticated;

drop trigger if exists injectable_products_touch_updated_at_v2 on public.injectable_products;
create trigger injectable_products_touch_updated_at_v2
before update on public.injectable_products
for each row execute function public.touch_injectable_catalog_updated_at_v2();

drop trigger if exists injectable_product_lots_touch_updated_at_v2 on public.injectable_product_lots;
create trigger injectable_product_lots_touch_updated_at_v2
before update on public.injectable_product_lots
for each row execute function public.touch_injectable_catalog_updated_at_v2();

-- -----------------------------------------------------------------------------
-- RLS and explicit grants: anon has zero access; authenticated sees only own rows.
-- Child writes additionally require the parent map to still be a draft.
-- -----------------------------------------------------------------------------

alter table public.injectable_products enable row level security;
alter table public.injectable_product_lots enable row level security;
alter table public.injectable_applications enable row level security;
alter table public.injectable_application_points enable row level security;

drop policy if exists injectable_maps_select_own on public.injectable_maps;
create policy injectable_maps_select_own
on public.injectable_maps for select to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()));

drop policy if exists injectable_maps_insert_own on public.injectable_maps;
create policy injectable_maps_insert_own
on public.injectable_maps for insert to authenticated
with check (
  (select auth.uid()) is not null
  and user_id = (select auth.uid())
  and (
    (source_type = 'v2' and status = 'draft')
    or (source_type = 'legacy' and status = 'finalized')
  )
);

drop policy if exists injectable_maps_update_own on public.injectable_maps;
create policy injectable_maps_update_own
on public.injectable_maps for update to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()) and status = 'draft')
with check ((select auth.uid()) is not null and user_id = (select auth.uid()));

drop policy if exists injectable_maps_delete_own on public.injectable_maps;
create policy injectable_maps_delete_own
on public.injectable_maps for delete to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()) and status = 'draft');

drop policy if exists injectable_products_select_own on public.injectable_products;
create policy injectable_products_select_own
on public.injectable_products for select to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()));

drop policy if exists injectable_products_insert_own on public.injectable_products;
create policy injectable_products_insert_own
on public.injectable_products for insert to authenticated
with check ((select auth.uid()) is not null and user_id = (select auth.uid()));

drop policy if exists injectable_products_update_own on public.injectable_products;
create policy injectable_products_update_own
on public.injectable_products for update to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()))
with check ((select auth.uid()) is not null and user_id = (select auth.uid()));

drop policy if exists injectable_products_delete_own on public.injectable_products;
create policy injectable_products_delete_own
on public.injectable_products for delete to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()));

drop policy if exists injectable_product_lots_select_own on public.injectable_product_lots;
create policy injectable_product_lots_select_own
on public.injectable_product_lots for select to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()));

drop policy if exists injectable_product_lots_insert_own on public.injectable_product_lots;
create policy injectable_product_lots_insert_own
on public.injectable_product_lots for insert to authenticated
with check ((select auth.uid()) is not null and user_id = (select auth.uid()));

drop policy if exists injectable_product_lots_update_own on public.injectable_product_lots;
create policy injectable_product_lots_update_own
on public.injectable_product_lots for update to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()))
with check ((select auth.uid()) is not null and user_id = (select auth.uid()));

drop policy if exists injectable_product_lots_delete_own on public.injectable_product_lots;
create policy injectable_product_lots_delete_own
on public.injectable_product_lots for delete to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()));

drop policy if exists injectable_applications_select_own on public.injectable_applications;
create policy injectable_applications_select_own
on public.injectable_applications for select to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()));

drop policy if exists injectable_applications_insert_own_draft on public.injectable_applications;
create policy injectable_applications_insert_own_draft
on public.injectable_applications for insert to authenticated
with check (
  (select auth.uid()) is not null
  and user_id = (select auth.uid())
  and exists (
    select 1 from public.injectable_maps im
    where im.id = map_id and im.user_id = (select auth.uid()) and im.status = 'draft'
  )
);

drop policy if exists injectable_applications_update_own_draft on public.injectable_applications;
create policy injectable_applications_update_own_draft
on public.injectable_applications for update to authenticated
using (
  (select auth.uid()) is not null
  and user_id = (select auth.uid())
  and exists (
    select 1 from public.injectable_maps im
    where im.id = map_id and im.user_id = (select auth.uid()) and im.status = 'draft'
  )
)
with check ((select auth.uid()) is not null and user_id = (select auth.uid()));

drop policy if exists injectable_applications_delete_own_draft on public.injectable_applications;
create policy injectable_applications_delete_own_draft
on public.injectable_applications for delete to authenticated
using (
  (select auth.uid()) is not null
  and user_id = (select auth.uid())
  and exists (
    select 1 from public.injectable_maps im
    where im.id = map_id and im.user_id = (select auth.uid()) and im.status = 'draft'
  )
);

drop policy if exists injectable_application_points_select_own on public.injectable_application_points;
create policy injectable_application_points_select_own
on public.injectable_application_points for select to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()));

drop policy if exists injectable_application_points_insert_own_draft on public.injectable_application_points;
create policy injectable_application_points_insert_own_draft
on public.injectable_application_points for insert to authenticated
with check (
  (select auth.uid()) is not null
  and user_id = (select auth.uid())
  and exists (
    select 1 from public.injectable_maps im
    where im.id = map_id and im.user_id = (select auth.uid()) and im.status = 'draft'
  )
);

drop policy if exists injectable_application_points_update_own_draft on public.injectable_application_points;
create policy injectable_application_points_update_own_draft
on public.injectable_application_points for update to authenticated
using (
  (select auth.uid()) is not null
  and user_id = (select auth.uid())
  and exists (
    select 1 from public.injectable_maps im
    where im.id = map_id and im.user_id = (select auth.uid()) and im.status = 'draft'
  )
)
with check ((select auth.uid()) is not null and user_id = (select auth.uid()));

drop policy if exists injectable_application_points_delete_own_draft on public.injectable_application_points;
create policy injectable_application_points_delete_own_draft
on public.injectable_application_points for delete to authenticated
using (
  (select auth.uid()) is not null
  and user_id = (select auth.uid())
  and exists (
    select 1 from public.injectable_maps im
    where im.id = map_id and im.user_id = (select auth.uid()) and im.status = 'draft'
  )
);

revoke all on table public.injectable_products from anon;
revoke all on table public.injectable_product_lots from anon;
revoke all on table public.injectable_applications from anon;
revoke all on table public.injectable_application_points from anon;

grant select, insert, update, delete on table public.injectable_products to authenticated;
grant select, insert, update, delete on table public.injectable_product_lots to authenticated;
grant select, insert, update, delete on table public.injectable_applications to authenticated;
grant select, insert, update, delete on table public.injectable_application_points to authenticated;

grant select, insert, update, delete on table public.injectable_products to service_role;
grant select, insert, update, delete on table public.injectable_product_lots to service_role;
grant select, insert, update, delete on table public.injectable_applications to service_role;
grant select, insert, update, delete on table public.injectable_application_points to service_role;
