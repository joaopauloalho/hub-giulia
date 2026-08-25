-- Cover owner-scoped composite foreign keys introduced by materials_inventory_v1.
-- This is additive because 20260825135113_materials_inventory_v1 is already applied in production.

create index if not exists inventory_movements_material_owner_fk_idx
  on public.inventory_movements (material_id, user_id);

create index if not exists inventory_movements_procedure_owner_fk_idx
  on public.inventory_movements (procedure_id, user_id);

create index if not exists inventory_movements_procedure_material_owner_fk_idx
  on public.inventory_movements (procedure_material_id, user_id);

create index if not exists procedure_materials_procedure_owner_fk_idx
  on public.procedure_materials (procedure_id, user_id);

create index if not exists procedure_materials_material_owner_fk_idx
  on public.procedure_materials (material_id, user_id);
