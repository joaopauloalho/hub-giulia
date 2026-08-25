-- Materials / consumables / inventory v1
-- Universal attendance consumables with authoritative stock, immutable cost snapshots,
-- idempotent inventory operations and compensating procedure reversals.

create table public.materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  unit_label text not null default 'un',
  unit_cost numeric(14,4) not null,
  stock_quantity numeric(12,3) not null default 0,
  minimum_stock numeric(12,3) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint materials_name_check check (btrim(name) <> ''),
  constraint materials_unit_label_check check (btrim(unit_label) <> ''),
  constraint materials_unit_cost_check check (unit_cost >= 0),
  constraint materials_stock_quantity_check check (stock_quantity >= 0),
  constraint materials_minimum_stock_check check (minimum_stock >= 0),
  constraint materials_id_user_id_unique unique (id, user_id)
);

create table public.procedure_materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  procedure_id uuid not null,
  material_id uuid not null,
  material_name_snapshot text not null,
  unit_label_snapshot text not null,
  quantity numeric(12,3) not null,
  unit_cost_snapshot numeric(14,4) not null,
  total_cost_snapshot numeric(18,4) not null,
  created_at timestamptz not null default now(),
  constraint procedure_materials_name_snapshot_check check (btrim(material_name_snapshot) <> ''),
  constraint procedure_materials_unit_snapshot_check check (btrim(unit_label_snapshot) <> ''),
  constraint procedure_materials_quantity_check check (quantity > 0),
  constraint procedure_materials_unit_cost_check check (unit_cost_snapshot >= 0),
  constraint procedure_materials_total_cost_check check (total_cost_snapshot >= 0 and abs(total_cost_snapshot - round(unit_cost_snapshot * quantity, 4)) <= 0.0001),
  constraint procedure_materials_id_user_id_unique unique (id, user_id),
  constraint procedure_materials_one_material_per_procedure unique (user_id, procedure_id, material_id),
  constraint procedure_materials_procedure_owner_fkey foreign key (procedure_id, user_id) references public.procedures(id, user_id) on delete cascade,
  constraint procedure_materials_material_owner_fkey foreign key (material_id, user_id) references public.materials(id, user_id)
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  material_id uuid not null,
  movement_type text not null,
  quantity_delta numeric(12,3) not null,
  unit_cost_snapshot numeric(14,4),
  procedure_id uuid,
  procedure_id_snapshot uuid,
  procedure_material_id uuid,
  procedure_material_id_snapshot uuid,
  reason text,
  idempotency_key text,
  idempotency_payload_hash text,
  created_at timestamptz not null default now(),
  created_by uuid,
  constraint inventory_movements_type_check check (movement_type in ('initial_stock','stock_entry','manual_adjustment','procedure_consumption','procedure_reversal')),
  constraint inventory_movements_delta_check check (quantity_delta <> 0 or movement_type = 'initial_stock'),
  constraint inventory_movements_unit_cost_check check (unit_cost_snapshot is null or unit_cost_snapshot >= 0),
  constraint inventory_movements_material_owner_fkey foreign key (material_id, user_id) references public.materials(id, user_id),
  constraint inventory_movements_procedure_owner_fkey foreign key (procedure_id, user_id) references public.procedures(id, user_id) on delete set null (procedure_id),
  constraint inventory_movements_procedure_material_owner_fkey foreign key (procedure_material_id, user_id) references public.procedure_materials(id, user_id) on delete set null (procedure_material_id)
);

create unique index inventory_movements_user_idempotency_uidx on public.inventory_movements(user_id, idempotency_key) where idempotency_key is not null;
create index materials_user_active_name_idx on public.materials(user_id, active, name);
create index procedure_materials_user_procedure_idx on public.procedure_materials(user_id, procedure_id);
create index procedure_materials_user_material_idx on public.procedure_materials(user_id, material_id);
create index inventory_movements_user_material_created_idx on public.inventory_movements(user_id, material_id, created_at desc);
create index inventory_movements_procedure_idx on public.inventory_movements(procedure_id) where procedure_id is not null;
create index inventory_movements_user_procedure_snapshot_idx on public.inventory_movements(user_id, procedure_id_snapshot) where procedure_id_snapshot is not null;

alter table public.materials enable row level security;
alter table public.procedure_materials enable row level security;
alter table public.inventory_movements enable row level security;

create policy materials_select_own on public.materials for select to authenticated using ((select auth.uid()) = user_id);
create policy materials_insert_own on public.materials for insert to authenticated with check ((select auth.uid()) = user_id);
create policy materials_update_own on public.materials for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy procedure_materials_select_own on public.procedure_materials for select to authenticated using ((select auth.uid()) = user_id);
create policy inventory_movements_select_own on public.inventory_movements for select to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.materials from public, anon, authenticated;
revoke all on table public.procedure_materials from public, anon, authenticated;
revoke all on table public.inventory_movements from public, anon, authenticated;
grant select, insert, update on table public.materials to authenticated;
grant select on table public.procedure_materials to authenticated;
grant select on table public.inventory_movements to authenticated;

create or replace function public.materials_inventory_guard_v1()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_context jsonb;
  v_expected numeric(12,3);
  v_delta numeric(12,3);
begin
  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id or new.id <> old.id or new.created_at <> old.created_at then
      raise exception using errcode='P0001', message='MATERIAL_IMMUTABLE_IDENTITY';
    end if;
    new.updated_at := now();
    if new.stock_quantity is not distinct from old.stock_quantity then
      return new;
    end if;
    v_delta := round(new.stock_quantity - old.stock_quantity, 3);
  else
    v_delta := round(new.stock_quantity, 3);
  end if;

  begin
    v_context := nullif(current_setting('hub.inventory_mutation_context', true), '')::jsonb;
  exception when others then
    v_context := null;
  end;

  if v_context is null
     or v_context->>'material_id' is distinct from new.id::text
     or nullif(v_context->>'idempotency_key','') is null
     or nullif(v_context->>'movement_type','') is null then
    raise exception using errcode='P0001', message='MATERIAL_STOCK_MUTATION_REQUIRES_LEDGER';
  end if;

  if tg_op = 'INSERT' and v_context->>'movement_type' <> 'initial_stock' then
    raise exception using errcode='P0001', message='MATERIAL_INITIAL_STOCK_CONTEXT_INVALID';
  end if;

  if tg_op = 'UPDATE' and v_context->>'movement_type' not in ('stock_entry','manual_adjustment','procedure_consumption','procedure_reversal') then
    raise exception using errcode='P0001', message='MATERIAL_STOCK_CONTEXT_INVALID';
  end if;

  begin
    v_expected := round((v_context->>'expected_delta')::numeric, 3);
  exception when others then
    raise exception using errcode='P0001', message='MATERIAL_STOCK_CONTEXT_INVALID';
  end;

  if abs(v_delta - v_expected) > 0.0005 then
    raise exception using errcode='P0001', message='MATERIAL_STOCK_CONTEXT_MISMATCH';
  end if;

  if new.stock_quantity < 0 then
    raise exception using errcode='P0001', message='MATERIAL_NEGATIVE_STOCK';
  end if;

  return new;
end;
$$;

create or replace function public.audit_material_stock_change_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_context jsonb;
  v_delta numeric(12,3);
  v_procedure_id uuid;
  v_procedure_material_id uuid;
begin
  if tg_op = 'UPDATE' and new.stock_quantity is not distinct from old.stock_quantity then
    return new;
  end if;

  v_context := nullif(current_setting('hub.inventory_mutation_context', true), '')::jsonb;
  v_delta := case when tg_op = 'INSERT' then round(new.stock_quantity,3) else round(new.stock_quantity-old.stock_quantity,3) end;
  v_procedure_id := nullif(v_context->>'procedure_id','')::uuid;
  v_procedure_material_id := nullif(v_context->>'procedure_material_id','')::uuid;

  insert into public.inventory_movements(
    user_id, material_id, movement_type, quantity_delta, unit_cost_snapshot,
    procedure_id, procedure_id_snapshot, procedure_material_id, procedure_material_id_snapshot,
    reason, idempotency_key, idempotency_payload_hash, created_by
  ) values (
    new.user_id,
    new.id,
    v_context->>'movement_type',
    v_delta,
    coalesce(nullif(v_context->>'unit_cost_snapshot','')::numeric, new.unit_cost),
    v_procedure_id,
    v_procedure_id,
    v_procedure_material_id,
    v_procedure_material_id,
    nullif(v_context->>'reason',''),
    v_context->>'idempotency_key',
    nullif(v_context->>'idempotency_payload_hash',''),
    coalesce(auth.uid(), new.user_id)
  );

  return new;
end;
$$;

create trigger materials_inventory_guard_biu
before insert or update on public.materials
for each row execute function public.materials_inventory_guard_v1();

create trigger materials_stock_audit_aiu
after insert or update on public.materials
for each row execute function public.audit_material_stock_change_v1();

create or replace function public.create_material_v1(
  p_idempotency_key uuid,
  p_name text,
  p_unit_label text,
  p_unit_cost numeric,
  p_initial_stock numeric,
  p_minimum_stock numeric,
  p_active boolean
) returns public.materials
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_key text;
  v_hash text;
  v_material_id uuid := gen_random_uuid();
  v_existing_material_id uuid;
  v_existing_hash text;
  v_result public.materials;
begin
  if v_user_id is null then raise exception using errcode='P0001', message='MATERIAL_SESSION_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception using errcode='22023', message='INVENTORY_IDEMPOTENCY_KEY_REQUIRED'; end if;
  if btrim(coalesce(p_name,'')) = '' then raise exception using errcode='22023', message='MATERIAL_NAME_REQUIRED'; end if;
  if btrim(coalesce(p_unit_label,'')) = '' then raise exception using errcode='22023', message='MATERIAL_UNIT_REQUIRED'; end if;
  if p_unit_cost is null or p_unit_cost < 0 then raise exception using errcode='22023', message='MATERIAL_UNIT_COST_INVALID'; end if;
  if coalesce(p_initial_stock,0) < 0 or coalesce(p_minimum_stock,0) < 0 then raise exception using errcode='22023', message='MATERIAL_STOCK_INVALID'; end if;

  v_key := 'material-create:' || p_idempotency_key::text;
  v_hash := md5(jsonb_build_object(
    'name', btrim(p_name), 'unit_label', btrim(p_unit_label), 'unit_cost', round(p_unit_cost,4),
    'initial_stock', round(coalesce(p_initial_stock,0),3), 'minimum_stock', round(coalesce(p_minimum_stock,0),3),
    'active', coalesce(p_active,true)
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || v_key, 0));

  select material_id, idempotency_payload_hash into v_existing_material_id, v_existing_hash
  from public.inventory_movements where user_id=v_user_id and idempotency_key=v_key;
  if found then
    if v_existing_hash is distinct from v_hash then raise exception using errcode='P0001', message='INVENTORY_IDEMPOTENCY_CONFLICT'; end if;
    select * into v_result from public.materials where id=v_existing_material_id and user_id=v_user_id;
    return v_result;
  end if;

  perform set_config('hub.inventory_mutation_context', jsonb_build_object(
    'material_id', v_material_id,
    'movement_type', 'initial_stock',
    'expected_delta', round(coalesce(p_initial_stock,0),3),
    'unit_cost_snapshot', round(p_unit_cost,4),
    'reason', 'Estoque inicial',
    'idempotency_key', v_key,
    'idempotency_payload_hash', v_hash
  )::text, true);

  insert into public.materials(id,user_id,name,unit_label,unit_cost,stock_quantity,minimum_stock,active)
  values(v_material_id,v_user_id,btrim(p_name),btrim(p_unit_label),round(p_unit_cost,4),round(coalesce(p_initial_stock,0),3),round(coalesce(p_minimum_stock,0),3),coalesce(p_active,true))
  returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.update_material_v1(
  p_material_id uuid,
  p_name text,
  p_unit_label text,
  p_unit_cost numeric,
  p_minimum_stock numeric,
  p_active boolean
) returns public.materials
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare v_user_id uuid := auth.uid(); v_result public.materials;
begin
  if v_user_id is null then raise exception using errcode='P0001', message='MATERIAL_SESSION_REQUIRED'; end if;
  if p_material_id is null then raise exception using errcode='22023', message='MATERIAL_REQUIRED'; end if;
  if btrim(coalesce(p_name,'')) = '' then raise exception using errcode='22023', message='MATERIAL_NAME_REQUIRED'; end if;
  if btrim(coalesce(p_unit_label,'')) = '' then raise exception using errcode='22023', message='MATERIAL_UNIT_REQUIRED'; end if;
  if p_unit_cost is null or p_unit_cost < 0 or p_minimum_stock is null or p_minimum_stock < 0 then raise exception using errcode='22023', message='MATERIAL_VALUE_INVALID'; end if;

  update public.materials set
    name=btrim(p_name), unit_label=btrim(p_unit_label), unit_cost=round(p_unit_cost,4),
    minimum_stock=round(p_minimum_stock,3), active=coalesce(p_active,true)
  where id=p_material_id and user_id=v_user_id
  returning * into v_result;
  if not found then raise exception using errcode='P0001', message='MATERIAL_FORBIDDEN'; end if;
  return v_result;
end;
$$;

create or replace function public.record_material_stock_entry_v1(
  p_idempotency_key uuid,
  p_material_id uuid,
  p_quantity numeric,
  p_reason text
) returns public.materials
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid(); v_key text; v_hash text; v_existing_hash text; v_existing_material_id uuid;
  v_material public.materials; v_result public.materials;
begin
  if v_user_id is null then raise exception using errcode='P0001', message='MATERIAL_SESSION_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception using errcode='22023', message='INVENTORY_IDEMPOTENCY_KEY_REQUIRED'; end if;
  if p_material_id is null or p_quantity is null or p_quantity <= 0 then raise exception using errcode='22023', message='MATERIAL_ENTRY_INVALID'; end if;
  v_key := 'stock-entry:' || p_idempotency_key::text;
  v_hash := md5(jsonb_build_object('material_id',p_material_id,'quantity',round(p_quantity,3),'reason',nullif(btrim(coalesce(p_reason,'')),''))::text);
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || v_key, 0));
  select material_id,idempotency_payload_hash into v_existing_material_id,v_existing_hash from public.inventory_movements where user_id=v_user_id and idempotency_key=v_key;
  if found then
    if v_existing_hash is distinct from v_hash then raise exception using errcode='P0001', message='INVENTORY_IDEMPOTENCY_CONFLICT'; end if;
    select * into v_result from public.materials where id=v_existing_material_id and user_id=v_user_id;
    return v_result;
  end if;
  select * into v_material from public.materials where id=p_material_id and user_id=v_user_id for update;
  if not found then raise exception using errcode='P0001', message='MATERIAL_FORBIDDEN'; end if;
  perform set_config('hub.inventory_mutation_context', jsonb_build_object(
    'material_id',v_material.id,'movement_type','stock_entry','expected_delta',round(p_quantity,3),
    'unit_cost_snapshot',v_material.unit_cost,'reason',coalesce(nullif(btrim(coalesce(p_reason,'')),''),'Entrada de estoque'),
    'idempotency_key',v_key,'idempotency_payload_hash',v_hash
  )::text,true);
  update public.materials set stock_quantity=round(stock_quantity+p_quantity,3) where id=v_material.id and user_id=v_user_id returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.adjust_material_stock_v1(
  p_idempotency_key uuid,
  p_material_id uuid,
  p_counted_quantity numeric,
  p_reason text
) returns public.materials
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid(); v_key text; v_hash text; v_existing_hash text; v_existing_material_id uuid;
  v_material public.materials; v_result public.materials; v_delta numeric(12,3);
begin
  if v_user_id is null then raise exception using errcode='P0001', message='MATERIAL_SESSION_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception using errcode='22023', message='INVENTORY_IDEMPOTENCY_KEY_REQUIRED'; end if;
  if p_material_id is null or p_counted_quantity is null or p_counted_quantity < 0 then raise exception using errcode='22023', message='MATERIAL_ADJUSTMENT_INVALID'; end if;
  if btrim(coalesce(p_reason,'')) = '' then raise exception using errcode='22023', message='MATERIAL_ADJUSTMENT_REASON_REQUIRED'; end if;
  v_key := 'stock-adjust:' || p_idempotency_key::text;
  v_hash := md5(jsonb_build_object('material_id',p_material_id,'counted_quantity',round(p_counted_quantity,3),'reason',btrim(p_reason))::text);
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || v_key, 0));
  select material_id,idempotency_payload_hash into v_existing_material_id,v_existing_hash from public.inventory_movements where user_id=v_user_id and idempotency_key=v_key;
  if found then
    if v_existing_hash is distinct from v_hash then raise exception using errcode='P0001', message='INVENTORY_IDEMPOTENCY_CONFLICT'; end if;
    select * into v_result from public.materials where id=v_existing_material_id and user_id=v_user_id;
    return v_result;
  end if;
  select * into v_material from public.materials where id=p_material_id and user_id=v_user_id for update;
  if not found then raise exception using errcode='P0001', message='MATERIAL_FORBIDDEN'; end if;
  v_delta := round(p_counted_quantity-v_material.stock_quantity,3);
  if v_delta = 0 then raise exception using errcode='22023', message='MATERIAL_ADJUSTMENT_NO_CHANGE'; end if;
  perform set_config('hub.inventory_mutation_context', jsonb_build_object(
    'material_id',v_material.id,'movement_type','manual_adjustment','expected_delta',v_delta,
    'unit_cost_snapshot',v_material.unit_cost,'reason',btrim(p_reason),
    'idempotency_key',v_key,'idempotency_payload_hash',v_hash
  )::text,true);
  update public.materials set stock_quantity=round(p_counted_quantity,3) where id=v_material.id and user_id=v_user_id returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.consume_materials_after_procedure_insert_v1()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_payload_hash text;
  v_expected_key text;
  v_materials jsonb;
  v_input record;
  v_material public.materials;
  v_procedure_material public.procedure_materials;
  v_materials_cost numeric(18,4) := 0;
begin
  v_payload_hash := nullif(current_setting('hub.attendance_payload_hash_v4',true),'');
  v_expected_key := nullif(current_setting('hub.attendance_idempotency_key_v4',true),'');
  if v_payload_hash is null or v_expected_key is null or new.idempotency_key is null or new.idempotency_key::text <> v_expected_key then
    return new;
  end if;
  begin
    v_materials := coalesce(nullif(current_setting('hub.attendance_materials_v1',true),'')::jsonb,'[]'::jsonb);
  exception when others then
    raise exception using errcode='22023', message='ATTENDANCE_MATERIALS_INVALID';
  end;
  if jsonb_typeof(v_materials) <> 'array' then raise exception using errcode='22023', message='ATTENDANCE_MATERIALS_INVALID'; end if;

  for v_input in
    select m.material_id, round(m.quantity,3) as quantity
    from jsonb_to_recordset(v_materials) as m(material_id uuid, quantity numeric)
    order by m.material_id
  loop
    select * into v_material from public.materials where id=v_input.material_id and user_id=new.user_id for update;
    if not found then
      raise exception using errcode='P0001', message='MATERIAL_FORBIDDEN', detail=jsonb_build_object('material_id',v_input.material_id)::text;
    end if;
    if not v_material.active then
      raise exception using errcode='P0001', message='MATERIAL_INACTIVE', detail=jsonb_build_object('material_id',v_material.id,'material_name',v_material.name)::text;
    end if;
    if v_input.quantity is null or v_input.quantity <= 0 then raise exception using errcode='22023', message='ATTENDANCE_MATERIAL_QUANTITY_INVALID'; end if;
    if v_material.stock_quantity < v_input.quantity then
      raise exception using errcode='P0001', message='MATERIAL_INSUFFICIENT_STOCK', detail=jsonb_build_object('material_id',v_material.id,'material_name',v_material.name,'requested',v_input.quantity,'available',v_material.stock_quantity,'unit_label',v_material.unit_label)::text;
    end if;

    insert into public.procedure_materials(user_id,procedure_id,material_id,material_name_snapshot,unit_label_snapshot,quantity,unit_cost_snapshot,total_cost_snapshot)
    values(new.user_id,new.id,v_material.id,v_material.name,v_material.unit_label,v_input.quantity,v_material.unit_cost,round(v_material.unit_cost*v_input.quantity,4))
    returning * into v_procedure_material;

    perform set_config('hub.inventory_mutation_context', jsonb_build_object(
      'material_id',v_material.id,'movement_type','procedure_consumption','expected_delta',-v_input.quantity,
      'unit_cost_snapshot',v_material.unit_cost,'procedure_id',new.id,'procedure_material_id',v_procedure_material.id,
      'reason','Consumo em atendimento','idempotency_key','procedure-consumption:'||v_procedure_material.id::text
    )::text,true);

    update public.materials set stock_quantity=round(stock_quantity-v_input.quantity,3) where id=v_material.id and user_id=new.user_id;
    v_materials_cost := v_materials_cost + round(v_material.unit_cost*v_input.quantity,4);
  end loop;

  update public.procedures
  set total_cost=round(total_cost + v_materials_cost,2), idempotency_payload_hash=v_payload_hash
  where id=new.id and user_id=new.user_id;
  perform set_config('hub.inventory_mutation_context','{}',true);
  return new;
end;
$$;

create trigger procedures_consume_materials_ai
  after insert on public.procedures
  for each row execute function public.consume_materials_after_procedure_insert_v1();

create or replace function public.reverse_material_consumption_before_procedure_delete_v1()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare v_pm public.procedure_materials; v_material public.materials; v_key text;
begin
  for v_pm in
    select * from public.procedure_materials where procedure_id=old.id and user_id=old.user_id order by material_id
  loop
    v_key := 'procedure-reversal:' || v_pm.id::text;
    if exists(select 1 from public.inventory_movements where user_id=old.user_id and idempotency_key=v_key) then
      continue;
    end if;
    select * into v_material from public.materials where id=v_pm.material_id and user_id=old.user_id for update;
    if not found then raise exception using errcode='P0001', message='MATERIAL_REVERSAL_MATERIAL_MISSING'; end if;
    if exists(select 1 from public.inventory_movements where user_id=old.user_id and idempotency_key=v_key) then
      continue;
    end if;
    perform set_config('hub.inventory_mutation_context', jsonb_build_object(
      'material_id',v_material.id,'movement_type','procedure_reversal','expected_delta',v_pm.quantity,
      'unit_cost_snapshot',v_pm.unit_cost_snapshot,'procedure_id',old.id,'procedure_material_id',v_pm.id,
      'reason','Estorno por exclusão/reversão do atendimento','idempotency_key',v_key
    )::text,true);
    update public.materials set stock_quantity=round(stock_quantity+v_pm.quantity,3) where id=v_material.id and user_id=old.user_id;
  end loop;
  perform set_config('hub.inventory_mutation_context','{}',true);
  return old;
end;
$$;

create trigger procedures_reverse_material_consumption_bd
  before delete on public.procedures
  for each row execute function public.reverse_material_consumption_before_procedure_delete_v1();

create or replace function public.create_procedure_v4(
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
) returns public.procedures
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_materials jsonb := coalesce(p_materials,'[]'::jsonb);
  v_materials_canonical jsonb;
  v_hash text;
  v_existing public.procedures;
  v_result public.procedures;
  v_count integer;
begin
  if v_user_id is null then raise exception using errcode='P0001', message='ATTENDANCE_SESSION_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception using errcode='22023', message='ATTENDANCE_IDEMPOTENCY_KEY_REQUIRED'; end if;
  if jsonb_typeof(v_materials) <> 'array' then raise exception using errcode='22023', message='ATTENDANCE_MATERIALS_INVALID'; end if;
  if exists(select 1 from jsonb_to_recordset(v_materials) as m(material_id uuid,quantity numeric) where m.material_id is null or m.quantity is null or m.quantity <= 0) then
    raise exception using errcode='22023', message='ATTENDANCE_MATERIAL_INVALID';
  end if;
  select count(*) into v_count from jsonb_to_recordset(v_materials) as m(material_id uuid,quantity numeric);
  if (select count(distinct m.material_id) from jsonb_to_recordset(v_materials) as m(material_id uuid,quantity numeric)) <> v_count then
    raise exception using errcode='22023', message='ATTENDANCE_DUPLICATE_MATERIAL';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('material_id',m.material_id,'quantity',round(m.quantity,3)) order by m.material_id),'[]'::jsonb)
  into v_materials_canonical from jsonb_to_recordset(v_materials) as m(material_id uuid,quantity numeric);

  v_hash := md5(jsonb_build_object(
    'v',4,'patient_id',p_patient_id,'appointment_id',p_appointment_id,'performed_at',p_performed_at,
    'items',p_items,'payment_entries',coalesce(p_payment_entries,'[]'::jsonb),'injectable_maps',coalesce(p_injectable_maps,'[]'::jsonb),
    'coverages',coalesce(p_coverages,'[]'::jsonb),'materials',v_materials_canonical,'notes',p_notes
  )::text);

  select * into v_existing from public.procedures where user_id=v_user_id and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.idempotency_payload_hash <> v_hash then raise exception using errcode='P0001', message='ATTENDANCE_IDEMPOTENCY_CONFLICT'; end if;
    return v_existing;
  end if;

  perform set_config('hub.attendance_payload_hash_v4',v_hash,true);
  perform set_config('hub.attendance_idempotency_key_v4',p_idempotency_key::text,true);
  perform set_config('hub.attendance_materials_v1',v_materials_canonical::text,true);

  begin
    select * into v_result from public.create_procedure_v3(
      p_idempotency_key,p_patient_id,p_appointment_id,p_performed_at,p_items,
      coalesce(p_payment_entries,'[]'::jsonb),coalesce(p_injectable_maps,'[]'::jsonb),coalesce(p_coverages,'[]'::jsonb),p_notes
    );
  exception when raise_exception then
    if sqlerrm = 'ATTENDANCE_IDEMPOTENCY_CONFLICT' then
      select * into v_existing from public.procedures where user_id=v_user_id and idempotency_key=p_idempotency_key;
      if found and v_existing.idempotency_payload_hash = v_hash then return v_existing; end if;
    end if;
    raise;
  end;
  return v_result;
end;
$$;

create or replace function public.create_procedure_with_injectable_draft_v4(
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
) returns public.procedures
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_materials jsonb := coalesce(p_materials,'[]'::jsonb);
  v_materials_canonical jsonb;
  v_hash text;
  v_existing public.procedures;
  v_result public.procedures;
  v_count integer;
begin
  if v_user_id is null then raise exception using errcode='P0001', message='ATTENDANCE_SESSION_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception using errcode='22023', message='ATTENDANCE_IDEMPOTENCY_KEY_REQUIRED'; end if;
  if p_draft_id is null or p_draft_revision is null then raise exception using errcode='22023', message='ATTENDANCE_INJECTABLE_DRAFT_REQUIRED'; end if;
  if jsonb_typeof(v_materials) <> 'array' then raise exception using errcode='22023', message='ATTENDANCE_MATERIALS_INVALID'; end if;
  if exists(select 1 from jsonb_to_recordset(v_materials) as m(material_id uuid,quantity numeric) where m.material_id is null or m.quantity is null or m.quantity <= 0) then raise exception using errcode='22023', message='ATTENDANCE_MATERIAL_INVALID'; end if;
  select count(*) into v_count from jsonb_to_recordset(v_materials) as m(material_id uuid,quantity numeric);
  if (select count(distinct m.material_id) from jsonb_to_recordset(v_materials) as m(material_id uuid,quantity numeric)) <> v_count then raise exception using errcode='22023', message='ATTENDANCE_DUPLICATE_MATERIAL'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('material_id',m.material_id,'quantity',round(m.quantity,3)) order by m.material_id),'[]'::jsonb)
  into v_materials_canonical from jsonb_to_recordset(v_materials) as m(material_id uuid,quantity numeric);

  v_hash := md5(jsonb_build_object(
    'v',4,'mode','injectable_draft','patient_id',p_patient_id,'appointment_id',p_appointment_id,'performed_at',p_performed_at,
    'items',p_items,'payment_entries',coalesce(p_payment_entries,'[]'::jsonb),'coverages',coalesce(p_coverages,'[]'::jsonb),
    'materials',v_materials_canonical,'notes',p_notes,'draft_id',p_draft_id,'draft_revision',p_draft_revision
  )::text);
  select * into v_existing from public.procedures where user_id=v_user_id and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.idempotency_payload_hash <> v_hash then raise exception using errcode='P0001', message='ATTENDANCE_IDEMPOTENCY_CONFLICT'; end if;
    return v_existing;
  end if;

  perform set_config('hub.attendance_payload_hash_v4',v_hash,true);
  perform set_config('hub.attendance_idempotency_key_v4',p_idempotency_key::text,true);
  perform set_config('hub.attendance_materials_v1',v_materials_canonical::text,true);
  begin
    select * into v_result from public.create_procedure_with_injectable_draft_v3(
      p_idempotency_key,p_patient_id,p_appointment_id,p_performed_at,p_items,
      coalesce(p_payment_entries,'[]'::jsonb),coalesce(p_coverages,'[]'::jsonb),p_notes,p_draft_id,p_draft_revision
    );
  exception when raise_exception then
    if sqlerrm = 'ATTENDANCE_IDEMPOTENCY_CONFLICT' then
      select * into v_existing from public.procedures where user_id=v_user_id and idempotency_key=p_idempotency_key;
      if found and v_existing.idempotency_payload_hash = v_hash then return v_existing; end if;
    end if;
    raise;
  end;
  return v_result;
end;
$$;

revoke execute on function public.materials_inventory_guard_v1() from public, anon, authenticated;
revoke execute on function public.audit_material_stock_change_v1() from public, anon, authenticated;
revoke execute on function public.consume_materials_after_procedure_insert_v1() from public, anon, authenticated;
revoke execute on function public.reverse_material_consumption_before_procedure_delete_v1() from public, anon, authenticated;

revoke execute on function public.create_material_v1(uuid,text,text,numeric,numeric,numeric,boolean) from public, anon;
revoke execute on function public.update_material_v1(uuid,text,text,numeric,numeric,boolean) from public, anon;
revoke execute on function public.record_material_stock_entry_v1(uuid,uuid,numeric,text) from public, anon;
revoke execute on function public.adjust_material_stock_v1(uuid,uuid,numeric,text) from public, anon;
revoke execute on function public.create_procedure_v4(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb,text) from public, anon;
revoke execute on function public.create_procedure_with_injectable_draft_v4(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,text,uuid,bigint) from public, anon;

grant execute on function public.create_material_v1(uuid,text,text,numeric,numeric,numeric,boolean) to authenticated;
grant execute on function public.update_material_v1(uuid,text,text,numeric,numeric,boolean) to authenticated;
grant execute on function public.record_material_stock_entry_v1(uuid,uuid,numeric,text) to authenticated;
grant execute on function public.adjust_material_stock_v1(uuid,uuid,numeric,text) to authenticated;
grant execute on function public.create_procedure_v4(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb,text) to authenticated;
grant execute on function public.create_procedure_with_injectable_draft_v4(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,text,uuid,bigint) to authenticated;
