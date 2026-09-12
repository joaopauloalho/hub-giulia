-- Keep clinical/inventory history intact while making deletion a single user action.
-- Materials with real history are soft-deleted; unused materials are still physically removed.

alter table public.materials
  add column if not exists deleted_at timestamptz;

create index if not exists materials_user_visible_name_idx
  on public.materials(user_id, active, name)
  where deleted_at is null;

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

  perform 1
    from public.materials
   where id = p_material_id
     and user_id = v_user_id
   for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'MATERIAL_NOT_FOUND';
  end if;

  -- Preserve audit/clinical history without exposing the material in current catalog flows.
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
    update public.materials
       set active = false,
           deleted_at = coalesce(deleted_at, now())
     where id = p_material_id
       and user_id = v_user_id;
    return;
  end if;

  -- An unused material only has its automatic initial_stock row, which can be removed safely.
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
