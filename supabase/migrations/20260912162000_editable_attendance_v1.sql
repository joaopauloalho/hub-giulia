-- Hub Giulia — edição segura de atendimentos existentes v1
-- Mantém o mesmo procedure_id, reconcilia estoque por diferença, recalcula custos/financeiro
-- e registra snapshot antes/depois para auditoria.

alter table public.procedures
  add column if not exists revision bigint not null default 1,
  add column if not exists updated_at timestamptz not null default now();

alter table public.procedures
  drop constraint if exists procedures_revision_check,
  add constraint procedures_revision_check check (revision >= 1);

alter table public.inventory_movements
  drop constraint if exists inventory_movements_type_check,
  add constraint inventory_movements_type_check check (
    movement_type in (
      'initial_stock','stock_entry','manual_adjustment','procedure_consumption','procedure_reversal',
      'procedure_edit_consumption','procedure_edit_reversal'
    )
  );

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

  if tg_op = 'UPDATE' and v_context->>'movement_type' not in (
    'stock_entry','manual_adjustment','procedure_consumption','procedure_reversal',
    'procedure_edit_consumption','procedure_edit_reversal'
  ) then
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

create table if not exists public.procedure_edit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  procedure_id uuid,
  procedure_id_snapshot uuid not null,
  patient_id_snapshot uuid not null,
  revision bigint not null,
  reason text,
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint procedure_edit_events_revision_check check (revision >= 2),
  constraint procedure_edit_events_procedure_owner_fkey foreign key (procedure_id, user_id)
    references public.procedures(id, user_id) on delete set null (procedure_id)
);

create index if not exists procedure_edit_events_user_procedure_idx
  on public.procedure_edit_events(user_id, procedure_id_snapshot, revision desc);

alter table public.procedure_edit_events enable row level security;
revoke all on table public.procedure_edit_events from public, anon, authenticated;
grant select on table public.procedure_edit_events to authenticated;

drop policy if exists procedure_edit_events_select_own on public.procedure_edit_events;
create policy procedure_edit_events_select_own
  on public.procedure_edit_events for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.update_procedure_v1(
  p_procedure_id uuid,
  p_expected_revision bigint,
  p_performed_at timestamptz,
  p_items jsonb,
  p_payment_entries jsonb,
  p_materials jsonb,
  p_clinical_minutes integer,
  p_notes text,
  p_reason text
) returns public.procedures
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_proc public.procedures;
  v_result public.procedures;
  v_before jsonb;
  v_after jsonb;
  v_event_id uuid := gen_random_uuid();
  v_next_revision bigint;
  v_item_count integer;
  v_owned_count integer;
  v_material_count integer;
  v_material_id uuid;
  v_material public.materials;
  v_pm public.procedure_materials;
  v_new_qty numeric(12,3);
  v_delta numeric(12,3);
  v_key text;
  v_services_ids jsonb := '[]'::jsonb;
  v_gross numeric(14,2) := 0;
  v_covered numeric(14,2) := 0;
  v_due numeric(14,2) := 0;
  v_payment_count integer := 0;
  v_allocated numeric(14,2) := 0;
  v_fee_total numeric(14,2) := 0;
  v_immediate_net numeric(14,2) := 0;
  v_payment_method text;
  v_minutes integer := coalesce(p_clinical_minutes, 0);
  v_hourly_rate numeric(12,2) := 0;
  v_clinical_cost numeric(14,2) := 0;
  v_items_cost numeric(18,4) := 0;
  v_materials_cost numeric(18,4) := 0;
begin
  if v_user_id is null then
    raise exception using errcode='P0001', message='ATTENDANCE_SESSION_REQUIRED';
  end if;
  if p_procedure_id is null then
    raise exception using errcode='22023', message='ATTENDANCE_PROCEDURE_REQUIRED';
  end if;
  if p_performed_at is null then
    raise exception using errcode='22023', message='ATTENDANCE_PERFORMED_AT_REQUIRED';
  end if;
  if v_minutes < 0 or v_minutes > 1440 then
    raise exception using errcode='22023', message='ATTENDANCE_CLINICAL_MINUTES_INVALID';
  end if;
  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode='22023', message='ATTENDANCE_ITEMS_REQUIRED';
  end if;
  if jsonb_typeof(coalesce(p_payment_entries, '[]'::jsonb)) <> 'array' then
    raise exception using errcode='22023', message='ATTENDANCE_PAYMENTS_INVALID';
  end if;
  if jsonb_typeof(coalesce(p_materials, '[]'::jsonb)) <> 'array' then
    raise exception using errcode='22023', message='ATTENDANCE_MATERIALS_INVALID';
  end if;

  select * into v_proc
  from public.procedures
  where id = p_procedure_id and user_id = v_user_id
  for update;
  if not found then
    raise exception using errcode='P0001', message='ATTENDANCE_PROCEDURE_FORBIDDEN';
  end if;

  if p_expected_revision is null or v_proc.revision <> p_expected_revision then
    raise exception using errcode='P0001', message='ATTENDANCE_EDIT_CONFLICT';
  end if;
  v_next_revision := v_proc.revision + 1;

  if exists(
    select 1
    from jsonb_to_recordset(p_items) as i(service_id uuid, qty numeric, final_price numeric, cost numeric)
    where i.service_id is null
       or coalesce(i.qty, 0) <= 0
       or i.final_price is null or i.final_price < 0
       or i.cost is null or i.cost < 0 or i.cost > 1000000
  ) then
    raise exception using errcode='22023', message='ATTENDANCE_ITEM_INVALID';
  end if;

  select count(*) into v_item_count
  from jsonb_to_recordset(p_items) as i(service_id uuid, qty numeric, final_price numeric, cost numeric);
  if (select count(distinct i.service_id) from jsonb_to_recordset(p_items) as i(service_id uuid, qty numeric, final_price numeric, cost numeric)) <> v_item_count then
    raise exception using errcode='22023', message='ATTENDANCE_DUPLICATE_SERVICE_ITEM';
  end if;
  select count(*) into v_owned_count
  from public.services s
  join jsonb_to_recordset(p_items) as i(service_id uuid, qty numeric, final_price numeric, cost numeric)
    on i.service_id = s.id
  where s.user_id = v_user_id;
  if v_owned_count <> v_item_count then
    raise exception using errcode='P0001', message='ATTENDANCE_SERVICE_FORBIDDEN';
  end if;

  if v_proc.attendance_type = 'return' and exists(
    select 1 from jsonb_to_recordset(p_items) as i(service_id uuid, qty numeric, final_price numeric, cost numeric)
    where abs(i.final_price) > 0.009
  ) then
    raise exception using errcode='22023', message='ATTENDANCE_RETURN_CHARGE_NOT_ALLOWED';
  end if;

  -- Package redemptions are immutable history. A covered item can have its internal cost edited,
  -- but not its service, quantity or commercial value.
  if exists(
    select 1
    from public.package_redemptions pr
    join public.procedure_items pi
      on pi.id = pr.procedure_item_id_snapshot and pi.user_id = pr.user_id
    left join jsonb_to_recordset(p_items) as i(service_id uuid, qty numeric, final_price numeric, cost numeric)
      on i.service_id = pi.service_id
    where pr.user_id = v_user_id
      and pr.procedure_id_snapshot = p_procedure_id
      and (i.service_id is null or abs(i.qty - pi.qty) > 0.0005 or abs(i.final_price - pi.final_price) > 0.009)
  ) then
    raise exception using errcode='P0001', message='ATTENDANCE_EDIT_PACKAGE_ITEM_LOCKED';
  end if;

  -- Do not orphan applications/returns/package history when an item is removed.
  if exists(
    select 1
    from public.procedure_items pi
    where pi.procedure_id = p_procedure_id
      and pi.user_id = v_user_id
      and not exists(
        select 1 from jsonb_to_recordset(p_items) as i(service_id uuid, qty numeric, final_price numeric, cost numeric)
        where i.service_id = pi.service_id
      )
      and (
        exists(select 1 from public.package_redemptions pr where pr.user_id=v_user_id and pr.procedure_item_id_snapshot=pi.id)
        or exists(select 1 from public.injectable_applications ia where ia.user_id=v_user_id and ia.procedure_item_id=pi.id)
        or exists(select 1 from public.procedure_returns rr where rr.user_id=v_user_id and rr.procedure_item_id=pi.id)
      )
  ) then
    raise exception using errcode='P0001', message='ATTENDANCE_EDIT_ITEM_HAS_LINKED_HISTORY';
  end if;

  if exists(
    select 1
    from jsonb_to_recordset(coalesce(p_materials,'[]'::jsonb)) as m(material_id uuid, quantity numeric)
    where m.material_id is null or m.quantity is null or m.quantity <= 0
  ) then
    raise exception using errcode='22023', message='ATTENDANCE_MATERIAL_INVALID';
  end if;
  select count(*) into v_material_count
  from jsonb_to_recordset(coalesce(p_materials,'[]'::jsonb)) as m(material_id uuid, quantity numeric);
  if (select count(distinct m.material_id) from jsonb_to_recordset(coalesce(p_materials,'[]'::jsonb)) as m(material_id uuid, quantity numeric)) <> v_material_count then
    raise exception using errcode='22023', message='ATTENDANCE_DUPLICATE_MATERIAL';
  end if;

  v_before := jsonb_build_object(
    'procedure', to_jsonb(v_proc),
    'items', coalesce((select jsonb_agg(to_jsonb(pi) order by pi.created_at, pi.id) from public.procedure_items pi where pi.procedure_id=p_procedure_id and pi.user_id=v_user_id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(to_jsonb(pp) order by pp.created_at, pp.id) from public.procedure_payments pp where pp.procedure_id=p_procedure_id and pp.user_id=v_user_id), '[]'::jsonb),
    'materials', coalesce((select jsonb_agg(to_jsonb(pm) order by pm.created_at, pm.id) from public.procedure_materials pm where pm.procedure_id=p_procedure_id and pm.user_id=v_user_id), '[]'::jsonb)
  );

  -- Update rows that keep the same service_id so their IDs remain stable for linked clinical history.
  update public.procedure_items pi
  set qty = i.qty,
      final_price = i.final_price,
      discount = greatest((pi.list_price * i.qty) - i.final_price, 0),
      cost_snapshot = i.cost,
      cost_snapshot_known = true,
      coverage_value_snapshot = case
        when exists(select 1 from public.package_redemptions pr where pr.user_id=v_user_id and pr.procedure_item_id_snapshot=pi.id)
          then pi.coverage_value_snapshot
        else 0
      end,
      amount_due_snapshot = case
        when exists(select 1 from public.package_redemptions pr where pr.user_id=v_user_id and pr.procedure_item_id_snapshot=pi.id)
          then pi.amount_due_snapshot
        else i.final_price
      end
  from jsonb_to_recordset(p_items) as i(service_id uuid, qty numeric, final_price numeric, cost numeric)
  where pi.procedure_id = p_procedure_id
    and pi.user_id = v_user_id
    and pi.service_id = i.service_id;

  -- Add newly reported services/products.
  insert into public.procedure_items(
    procedure_id,user_id,service_id,name,qty,list_price,final_price,discount,cost_snapshot,
    coverage_value_snapshot,amount_due_snapshot,cost_snapshot_known
  )
  select p_procedure_id,v_user_id,s.id,s.name,i.qty,s.price,i.final_price,
         greatest((s.price*i.qty)-i.final_price,0),i.cost,0,i.final_price,true
  from jsonb_to_recordset(p_items) as i(service_id uuid, qty numeric, final_price numeric, cost numeric)
  join public.services s on s.id=i.service_id and s.user_id=v_user_id
  where not exists(
    select 1 from public.procedure_items pi
    where pi.procedure_id=p_procedure_id and pi.user_id=v_user_id and pi.service_id=i.service_id
  );

  delete from public.procedure_items pi
  where pi.procedure_id=p_procedure_id
    and pi.user_id=v_user_id
    and not exists(
      select 1 from jsonb_to_recordset(p_items) as i(service_id uuid, qty numeric, final_price numeric, cost numeric)
      where i.service_id=pi.service_id
    );

  select coalesce(jsonb_agg(e.value->'service_id' order by e.ordinality), '[]'::jsonb)
    into v_services_ids
  from jsonb_array_elements(p_items) with ordinality as e(value, ordinality);

  -- Lock every material touched by either the old or the new state in deterministic order.
  for v_material_id in
    select distinct x.material_id
    from (
      select pm.material_id from public.procedure_materials pm where pm.procedure_id=p_procedure_id and pm.user_id=v_user_id
      union all
      select m.material_id from jsonb_to_recordset(coalesce(p_materials,'[]'::jsonb)) as m(material_id uuid, quantity numeric)
    ) x
    order by x.material_id
  loop
    select * into v_material from public.materials where id=v_material_id and user_id=v_user_id for update;
    if not found then
      raise exception using errcode='P0001', message='MATERIAL_FORBIDDEN';
    end if;
  end loop;

  -- Materials removed from the edited attendance are returned to stock.
  for v_pm in
    select * from public.procedure_materials pm
    where pm.procedure_id=p_procedure_id and pm.user_id=v_user_id
      and not exists(
        select 1 from jsonb_to_recordset(coalesce(p_materials,'[]'::jsonb)) as m(material_id uuid, quantity numeric)
        where m.material_id=pm.material_id
      )
    order by pm.material_id
  loop
    select * into v_material from public.materials where id=v_pm.material_id and user_id=v_user_id;
    v_key := 'procedure-edit:'||p_procedure_id::text||':'||v_next_revision::text||':'||v_pm.material_id::text||':reversal';
    perform set_config('hub.inventory_mutation_context', jsonb_build_object(
      'material_id',v_material.id,'movement_type','procedure_edit_reversal','expected_delta',v_pm.quantity,
      'unit_cost_snapshot',v_pm.unit_cost_snapshot,'procedure_id',p_procedure_id,'procedure_material_id',v_pm.id,
      'reason','Correção de material em edição do atendimento','idempotency_key',v_key
    )::text,true);
    update public.materials set stock_quantity=round(stock_quantity+v_pm.quantity,3)
      where id=v_material.id and user_id=v_user_id;
    delete from public.procedure_materials where id=v_pm.id and user_id=v_user_id;
  end loop;

  -- Reconcile kept/new materials only by the quantity difference.
  for v_material_id, v_new_qty in
    select m.material_id, round(m.quantity,3)
    from jsonb_to_recordset(coalesce(p_materials,'[]'::jsonb)) as m(material_id uuid, quantity numeric)
    order by m.material_id
  loop
    select * into v_material from public.materials where id=v_material_id and user_id=v_user_id;
    select * into v_pm from public.procedure_materials
      where procedure_id=p_procedure_id and user_id=v_user_id and material_id=v_material_id;

    if found then
      v_delta := round(v_new_qty-v_pm.quantity,3);
      if v_delta > 0 then
        if not v_material.active then
          raise exception using errcode='P0001', message='MATERIAL_INACTIVE';
        end if;
        if v_material.stock_quantity < v_delta then
          raise exception using errcode='P0001', message='MATERIAL_INSUFFICIENT_STOCK',
            detail=jsonb_build_object('material_id',v_material.id,'material_name',v_material.name,'requested',v_delta,'available',v_material.stock_quantity,'unit_label',v_material.unit_label)::text;
        end if;
        v_key := 'procedure-edit:'||p_procedure_id::text||':'||v_next_revision::text||':'||v_material.id::text||':consumption';
        perform set_config('hub.inventory_mutation_context', jsonb_build_object(
          'material_id',v_material.id,'movement_type','procedure_edit_consumption','expected_delta',-v_delta,
          'unit_cost_snapshot',v_pm.unit_cost_snapshot,'procedure_id',p_procedure_id,'procedure_material_id',v_pm.id,
          'reason','Acréscimo de material em edição do atendimento','idempotency_key',v_key
        )::text,true);
        update public.materials set stock_quantity=round(stock_quantity-v_delta,3)
          where id=v_material.id and user_id=v_user_id;
      elsif v_delta < 0 then
        v_key := 'procedure-edit:'||p_procedure_id::text||':'||v_next_revision::text||':'||v_material.id::text||':reversal';
        perform set_config('hub.inventory_mutation_context', jsonb_build_object(
          'material_id',v_material.id,'movement_type','procedure_edit_reversal','expected_delta',-v_delta,
          'unit_cost_snapshot',v_pm.unit_cost_snapshot,'procedure_id',p_procedure_id,'procedure_material_id',v_pm.id,
          'reason','Redução de material em edição do atendimento','idempotency_key',v_key
        )::text,true);
        update public.materials set stock_quantity=round(stock_quantity-v_delta,3)
          where id=v_material.id and user_id=v_user_id;
      end if;
      update public.procedure_materials
        set quantity=v_new_qty,total_cost_snapshot=round(unit_cost_snapshot*v_new_qty,4)
        where id=v_pm.id and user_id=v_user_id;
    else
      if not v_material.active then
        raise exception using errcode='P0001', message='MATERIAL_INACTIVE';
      end if;
      if v_material.stock_quantity < v_new_qty then
        raise exception using errcode='P0001', message='MATERIAL_INSUFFICIENT_STOCK',
          detail=jsonb_build_object('material_id',v_material.id,'material_name',v_material.name,'requested',v_new_qty,'available',v_material.stock_quantity,'unit_label',v_material.unit_label)::text;
      end if;
      insert into public.procedure_materials(
        user_id,procedure_id,material_id,material_name_snapshot,unit_label_snapshot,quantity,unit_cost_snapshot,total_cost_snapshot
      ) values(
        v_user_id,p_procedure_id,v_material.id,v_material.name,v_material.unit_label,v_new_qty,v_material.unit_cost,round(v_material.unit_cost*v_new_qty,4)
      ) returning * into v_pm;
      v_key := 'procedure-edit:'||p_procedure_id::text||':'||v_next_revision::text||':'||v_material.id::text||':consumption';
      perform set_config('hub.inventory_mutation_context', jsonb_build_object(
        'material_id',v_material.id,'movement_type','procedure_edit_consumption','expected_delta',-v_new_qty,
        'unit_cost_snapshot',v_material.unit_cost,'procedure_id',p_procedure_id,'procedure_material_id',v_pm.id,
        'reason','Novo material em edição do atendimento','idempotency_key',v_key
      )::text,true);
      update public.materials set stock_quantity=round(stock_quantity-v_new_qty,3)
        where id=v_material.id and user_id=v_user_id;
    end if;
  end loop;
  perform set_config('hub.inventory_mutation_context','{}',true);

  select round(coalesce(sum(pi.final_price),0),2),
         round(coalesce(sum(pi.coverage_value_snapshot),0),2),
         round(coalesce(sum(pi.amount_due_snapshot),0),2),
         round(coalesce(sum(pi.cost_snapshot*pi.qty),0),4)
    into v_gross,v_covered,v_due,v_items_cost
  from public.procedure_items pi
  where pi.procedure_id=p_procedure_id and pi.user_id=v_user_id;

  if v_proc.attendance_type='return' then
    v_gross:=0; v_covered:=0; v_due:=0;
  end if;

  if exists(
    select 1
    from jsonb_to_recordset(coalesce(p_payment_entries,'[]'::jsonb))
      as pay(method text,base_amount numeric,amount numeric,card_brand text,installments integer,fee_pct numeric,fee_value numeric,net_amount numeric,absorve_taxa boolean,scheduled_date date,paid_at timestamptz)
    where pay.method not in ('dinheiro','pix','cartao_credito','cartao_debito')
       or pay.base_amount is null or pay.base_amount < 0
       or pay.amount is null or pay.amount < 0
       or pay.net_amount is null or pay.net_amount < 0
       or coalesce(pay.installments,1) < 1
       or (pay.fee_pct is not null and (pay.fee_pct < 0 or pay.fee_pct > 100))
       or (pay.fee_value is not null and pay.fee_value < 0)
       or abs(pay.amount-coalesce(pay.fee_value,0)-pay.net_amount) > 0.02
       or (pay.method in ('cartao_credito','cartao_debito') and pay.card_brand not in ('master_visa','elo'))
       or (pay.method not in ('cartao_credito','cartao_debito') and pay.card_brand is not null)
       or (pay.method <> 'cartao_credito' and coalesce(pay.installments,1) <> 1)
  ) then
    raise exception using errcode='22023', message='ATTENDANCE_PAYMENT_INVALID';
  end if;

  select count(*),round(coalesce(sum(pay.base_amount),0),2),
         round(coalesce(sum(coalesce(pay.fee_value,0)),0),2),
         round(coalesce(sum(case when pay.paid_at is not null then pay.net_amount else 0 end),0),2)
    into v_payment_count,v_allocated,v_fee_total,v_immediate_net
  from jsonb_to_recordset(coalesce(p_payment_entries,'[]'::jsonb))
    as pay(method text,base_amount numeric,amount numeric,card_brand text,installments integer,fee_pct numeric,fee_value numeric,net_amount numeric,absorve_taxa boolean,scheduled_date date,paid_at timestamptz);

  if v_due <= 0.009 then
    if v_payment_count <> 0 then
      raise exception using errcode='22023', message='ATTENDANCE_ZERO_PAYMENT_NOT_ALLOWED';
    end if;
    v_payment_method := case when v_covered > 0.009 then 'package_credit' else 'cortesia' end;
  else
    if v_payment_count < 1 then
      raise exception using errcode='22023', message='ATTENDANCE_PAYMENTS_REQUIRED';
    end if;
    if abs(v_allocated-v_due) > 0.02 then
      raise exception using errcode='22023', message='ATTENDANCE_PAYMENT_TOTAL_MISMATCH';
    end if;
    if v_payment_count = 1 then
      select pay.method into v_payment_method
      from jsonb_to_recordset(p_payment_entries)
        as pay(method text,base_amount numeric,amount numeric,card_brand text,installments integer,fee_pct numeric,fee_value numeric,net_amount numeric,absorve_taxa boolean,scheduled_date date,paid_at timestamptz)
      limit 1;
    else
      v_payment_method := 'split';
    end if;
  end if;

  delete from public.procedure_payments
    where procedure_id=p_procedure_id and user_id=v_user_id;
  if v_due > 0.009 then
    insert into public.procedure_payments(
      procedure_id,user_id,method,amount,card_brand,installments,fee_pct,fee_value,net_amount,absorve_taxa,scheduled_date,paid_at
    )
    select p_procedure_id,v_user_id,pay.method,pay.amount,pay.card_brand,coalesce(pay.installments,1),
           pay.fee_pct,pay.fee_value,pay.net_amount,coalesce(pay.absorve_taxa,true),pay.scheduled_date,pay.paid_at
    from jsonb_to_recordset(p_payment_entries)
      as pay(method text,base_amount numeric,amount numeric,card_brand text,installments integer,fee_pct numeric,fee_value numeric,net_amount numeric,absorve_taxa boolean,scheduled_date date,paid_at timestamptz);
  end if;

  if v_proc.clinical_cost_applied then
    v_hourly_rate := v_proc.clinical_hourly_rate_snapshot;
  else
    select coalesce(hourly_rate,0) into v_hourly_rate
    from public.clinic_cost_settings where user_id=v_user_id;
    v_hourly_rate := coalesce(v_hourly_rate,0);
  end if;
  v_clinical_cost := round((v_minutes::numeric/60)*v_hourly_rate,2);

  select round(coalesce(sum(pm.total_cost_snapshot),0),4) into v_materials_cost
  from public.procedure_materials pm
  where pm.procedure_id=p_procedure_id and pm.user_id=v_user_id;

  update public.procedures
  set performed_at=p_performed_at,
      services_ids=v_services_ids,
      total_value=v_due,
      gross_value=v_gross,
      covered_value=v_covered,
      total_cost=round(v_items_cost+v_materials_cost+v_clinical_cost,2),
      payment_method=v_payment_method,
      card_fee_pct=null,
      card_fee_value=nullif(v_fee_total,0),
      net_value=v_immediate_net,
      notes=nullif(btrim(coalesce(p_notes,'')),''),
      clinical_minutes=v_minutes,
      clinical_hourly_rate_snapshot=v_hourly_rate,
      clinical_time_cost=v_clinical_cost,
      clinical_cost_applied=true,
      revision=v_next_revision,
      updated_at=now()
  where id=p_procedure_id and user_id=v_user_id
  returning * into v_result;

  v_after := jsonb_build_object(
    'procedure', to_jsonb(v_result),
    'items', coalesce((select jsonb_agg(to_jsonb(pi) order by pi.created_at, pi.id) from public.procedure_items pi where pi.procedure_id=p_procedure_id and pi.user_id=v_user_id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(to_jsonb(pp) order by pp.created_at, pp.id) from public.procedure_payments pp where pp.procedure_id=p_procedure_id and pp.user_id=v_user_id), '[]'::jsonb),
    'materials', coalesce((select jsonb_agg(to_jsonb(pm) order by pm.created_at, pm.id) from public.procedure_materials pm where pm.procedure_id=p_procedure_id and pm.user_id=v_user_id), '[]'::jsonb)
  );

  insert into public.procedure_edit_events(
    id,user_id,procedure_id,procedure_id_snapshot,patient_id_snapshot,revision,reason,before_snapshot,after_snapshot,created_by
  ) values(
    v_event_id,v_user_id,p_procedure_id,p_procedure_id,v_proc.patient_id,v_next_revision,
    coalesce(nullif(btrim(coalesce(p_reason,'')),''),'Edição manual do atendimento'),v_before,v_after,v_user_id
  );

  return v_result;
end;
$$;

revoke execute on function public.update_procedure_v1(uuid,bigint,timestamptz,jsonb,jsonb,jsonb,integer,text,text) from public, anon;
grant execute on function public.update_procedure_v1(uuid,bigint,timestamptz,jsonb,jsonb,jsonb,integer,text,text) to authenticated;

revoke execute on function public.materials_inventory_guard_v1() from public, anon, authenticated;
