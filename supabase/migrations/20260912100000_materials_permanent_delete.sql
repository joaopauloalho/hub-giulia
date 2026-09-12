-- Permanent material deletion is intentionally restricted to records without real history.
-- The initial_stock ledger entry is implementation detail and may be removed together
-- with an otherwise unused material. Any later stock movement or procedure use keeps
-- the material immutable for clinical/inventory traceability; in that case it must be
-- deactivated instead of deleted.

create or replace function public.delete_material_v1(p_material_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'MATERIAL_SESSION_REQUIRED';
  end if;

  if p_material_id is null then
    raise exception using errcode = '22023', message = 'MATERIAL_REQUIRED';
  end if;

  -- Lock and scope the material to the authenticated owner before touching the ledger.
  perform 1
    from public.materials
   where id = p_material_id
     and user_id = v_user_id
   for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'MATERIAL_NOT_FOUND';
  end if;

  -- Any procedure usage or movement after creation is historical data and must survive.
  if exists (
    select 1
      from public.procedure_materials
     where material_id = p_material_id
       and user_id = v_user_id
  ) or exists (
    select 1
      from public.inventory_movements
     where material_id = p_material_id
       and user_id = v_user_id
       and movement_type <> 'initial_stock'
  ) then
    raise exception using errcode = 'P0001', message = 'MATERIAL_DELETE_HAS_HISTORY';
  end if;

  -- Every material gets an initial_stock audit row on creation. It is safe to remove
  -- only because the guards above proved that no real inventory/procedure history exists.
  delete from public.inventory_movements
   where material_id = p_material_id
     and user_id = v_user_id
     and movement_type = 'initial_stock';

  delete from public.materials
   where id = p_material_id
     and user_id = v_user_id;
end;
$$;

revoke all on function public.delete_material_v1(uuid) from public, anon;
grant execute on function public.delete_material_v1(uuid) to authenticated;
