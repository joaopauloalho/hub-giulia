-- Hub Giulia 2.3 — Injetáveis 2.0
-- Final ownership/linkage hardening.

-- A lot belongs not only to the same tenant but to the same selected product.
create unique index if not exists injectable_product_lots_id_product_user_uidx
  on public.injectable_product_lots (id, product_id, user_id);

alter table public.injectable_applications
  drop constraint if exists injectable_applications_lot_owner_fkey;

alter table public.injectable_applications
  add constraint injectable_applications_lot_product_owner_fkey
  foreign key (lot_id, product_id, user_id)
  references public.injectable_product_lots(id, product_id, user_id)
  on delete restrict;

-- Finalized records must always represent an actual completed attendance.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'injectable_maps_finalized_link_check'
      and conrelid = 'public.injectable_maps'::regclass
  ) then
    alter table public.injectable_maps
      add constraint injectable_maps_finalized_link_check
      check (
        status <> 'finalized'
        or (procedure_id is not null and finalized_at is not null)
      );
  end if;
end $$;

-- Replace the lifecycle guard so procedure linkage cannot be changed through a
-- direct table update. Only finalize_injectable_map_v2 may make that transition.
create or replace function public.guard_injectable_map_history_v2()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_finalizing boolean := coalesce(current_setting('hub.injectable_finalizing', true), '') = '1';
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

  if new.procedure_id is distinct from old.procedure_id and not v_finalizing then
    raise exception using errcode = 'P0001', message = 'INJECTABLE_PROCEDURE_LINK_RPC_REQUIRED';
  end if;

  if new.finalization_key is distinct from old.finalization_key and not v_finalizing then
    raise exception using errcode = 'P0001', message = 'INJECTABLE_FINALIZE_RPC_REQUIRED';
  end if;

  if new.finalized_at is distinct from old.finalized_at and not v_finalizing then
    raise exception using errcode = 'P0001', message = 'INJECTABLE_FINALIZE_RPC_REQUIRED';
  end if;

  if new.status <> 'draft' and not v_finalizing then
    raise exception using errcode = 'P0001', message = 'INJECTABLE_FINALIZE_RPC_REQUIRED';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_injectable_map_history_v2() from public, anon, authenticated;
