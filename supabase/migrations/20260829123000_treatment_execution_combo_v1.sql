-- Hub Giulia — Treatment execution / combo composition v1
-- A combo remains a commercial catalog item, while its composition defines the
-- executable clinical sessions granted when that combo becomes a patient package.

create table public.service_combo_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  combo_service_id uuid not null,
  component_service_id uuid not null,
  quantity numeric(12,3) not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint service_combo_items_quantity_check check (quantity > 0),
  constraint service_combo_items_not_self_check check (combo_service_id <> component_service_id),
  constraint service_combo_items_combo_owner_fkey foreign key (combo_service_id, user_id)
    references public.services(id, user_id) on delete cascade,
  constraint service_combo_items_component_owner_fkey foreign key (component_service_id, user_id)
    references public.services(id, user_id) on delete restrict
);

create unique index service_combo_items_id_user_id_uidx
  on public.service_combo_items(id, user_id);
create unique index service_combo_items_combo_component_uidx
  on public.service_combo_items(user_id, combo_service_id, component_service_id);
create index service_combo_items_combo_sort_idx
  on public.service_combo_items(user_id, combo_service_id, sort_order, id);
create index service_combo_items_component_idx
  on public.service_combo_items(user_id, component_service_id);

alter table public.service_combo_items enable row level security;
create policy service_combo_items_select_own
  on public.service_combo_items
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.validate_service_combo_item_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_combo_type text;
  v_component_type text;
begin
  select type into v_combo_type
  from public.services
  where id = new.combo_service_id and user_id = new.user_id;

  select type into v_component_type
  from public.services
  where id = new.component_service_id and user_id = new.user_id;

  if v_combo_type is distinct from 'combo' then
    raise exception using errcode = '23514', message = 'COMBO_PARENT_MUST_BE_COMBO';
  end if;
  if v_component_type is distinct from 'servico' then
    raise exception using errcode = '23514', message = 'COMBO_COMPONENT_MUST_BE_SERVICE';
  end if;
  return new;
end;
$$;

create trigger service_combo_items_validate
before insert or update on public.service_combo_items
for each row execute function public.validate_service_combo_item_v1();

create or replace function public.replace_service_combo_items_v1(
  p_combo_service_id uuid,
  p_items jsonb
)
returns setof public.service_combo_items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
  v_owned_count integer;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'COMBO_SESSION_REQUIRED';
  end if;
  if p_combo_service_id is null then
    raise exception using errcode = '22023', message = 'COMBO_SERVICE_REQUIRED';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'COMBO_ITEMS_INVALID';
  end if;

  perform 1 from public.services
  where id = p_combo_service_id and user_id = v_user_id and type = 'combo';
  if not found then
    raise exception using errcode = 'P0001', message = 'COMBO_SERVICE_FORBIDDEN';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
      as x(component_service_id uuid, quantity numeric)
    where x.component_service_id is null
       or x.component_service_id = p_combo_service_id
       or x.quantity is null
       or x.quantity <= 0
  ) then
    raise exception using errcode = '22023', message = 'COMBO_ITEM_INVALID';
  end if;

  select count(*) into v_count
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
    as x(component_service_id uuid, quantity numeric);

  if (
    select count(distinct x.component_service_id)
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
      as x(component_service_id uuid, quantity numeric)
  ) <> v_count then
    raise exception using errcode = '22023', message = 'COMBO_DUPLICATE_COMPONENT';
  end if;

  select count(*) into v_owned_count
  from public.services s
  join jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
    as x(component_service_id uuid, quantity numeric)
    on x.component_service_id = s.id
  where s.user_id = v_user_id
    and s.type = 'servico';

  if v_owned_count <> v_count then
    raise exception using errcode = 'P0001', message = 'COMBO_COMPONENT_FORBIDDEN';
  end if;

  delete from public.service_combo_items
  where user_id = v_user_id and combo_service_id = p_combo_service_id;

  insert into public.service_combo_items(
    user_id, combo_service_id, component_service_id, quantity, sort_order
  )
  select
    v_user_id,
    p_combo_service_id,
    (e.value ->> 'component_service_id')::uuid,
    round((e.value ->> 'quantity')::numeric, 3),
    e.ordinality::integer - 1
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
    with ordinality as e(value, ordinality);

  return query
  select c.*
  from public.service_combo_items c
  where c.user_id = v_user_id and c.combo_service_id = p_combo_service_id
  order by c.sort_order, c.id;
end;
$$;

revoke all on table public.service_combo_items from anon;
revoke insert, update, delete on table public.service_combo_items from authenticated;
grant select on table public.service_combo_items to authenticated;
revoke all on function public.replace_service_combo_items_v1(uuid, jsonb) from public, anon;
grant execute on function public.replace_service_combo_items_v1(uuid, jsonb) to authenticated;

alter table public.patient_package_items
  add column source_combo_service_id uuid,
  add column source_combo_name_snapshot text;

alter table public.patient_package_items
  add constraint patient_package_items_source_combo_pair_check
  check (
    (source_combo_service_id is null and source_combo_name_snapshot is null)
    or (source_combo_service_id is not null and nullif(btrim(source_combo_name_snapshot), '') is not null)
  );

create index patient_package_items_source_combo_idx
  on public.patient_package_items(user_id, source_combo_service_id)
  where source_combo_service_id is not null;

-- Accepted proposal -> package. Configured combos are expanded into executable
-- component sessions. Unconfigured combos remain compatible as a single item.
create or replace function public.create_package_from_proposal_v1(
  p_proposal_version_id uuid,
  p_idempotency_key uuid,
  p_valid_from date default null,
  p_valid_until date default null,
  p_notes text default null
)
returns public.patient_packages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_version public.treatment_proposal_versions;
  v_package public.patient_packages;
  v_existing public.patient_packages;
  v_deal_id uuid;
  v_patient_id uuid;
begin
  if v_user_id is null then raise exception using errcode='P0001',message='PACKAGE_SESSION_REQUIRED'; end if;
  if p_proposal_version_id is null then raise exception using errcode='22023',message='PACKAGE_PROPOSAL_VERSION_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception using errcode='22023',message='PACKAGE_IDEMPOTENCY_REQUIRED'; end if;
  if p_valid_until is not null and p_valid_from is not null and p_valid_until < p_valid_from then raise exception using errcode='22023',message='PACKAGE_VALIDITY_INVALID'; end if;

  select * into v_existing
  from public.patient_packages
  where user_id = v_user_id and source_proposal_version_id = p_proposal_version_id;
  if found then return v_existing; end if;

  select pv.* into v_version
  from public.treatment_proposal_versions pv
  where pv.id = p_proposal_version_id and pv.user_id = v_user_id
  for update;
  if not found then raise exception using errcode='P0001',message='PACKAGE_PROPOSAL_FORBIDDEN'; end if;
  if v_version.status <> 'accepted' then raise exception using errcode='P0001',message='PACKAGE_PROPOSAL_NOT_ACCEPTED'; end if;

  select tp.deal_id, c.patient_id into v_deal_id, v_patient_id
  from public.treatment_proposals tp
  join public.deals d on d.id = tp.deal_id and d.user_id = tp.user_id
  join public.contacts c on c.id = d.contact_id and c.user_id = d.user_id
  where tp.id = v_version.proposal_id and tp.user_id = v_user_id;
  if v_patient_id is null then raise exception using errcode='P0001',message='PACKAGE_PROPOSAL_PATIENT_REQUIRED'; end if;
  if not exists(select 1 from public.treatment_proposal_items where proposal_version_id=v_version.id and user_id=v_user_id) then
    raise exception using errcode='P0001',message='PACKAGE_PROPOSAL_ITEMS_REQUIRED';
  end if;

  insert into public.patient_packages(
    user_id, patient_id, title_snapshot, source_type, source_proposal_version_id,
    source_deal_id, status, commercial_total_snapshot, valid_from, valid_until,
    notes, creation_reason, creation_idempotency_key, created_by
  ) values (
    v_user_id, v_patient_id, v_version.title, 'proposal', v_version.id,
    v_deal_id, 'draft', v_version.total_value, p_valid_from, p_valid_until,
    p_notes, 'Proposta aceita', p_idempotency_key, v_user_id
  ) returning * into v_package;

  insert into public.patient_package_items(
    user_id, package_id, service_id, service_name_snapshot, quantity_granted,
    unit_label_snapshot, commercial_value_snapshot, sort_order,
    source_combo_service_id, source_combo_name_snapshot
  )
  with source_items as (
    select
      i.id as source_item_id,
      i.service_id,
      i.service_name_snapshot,
      i.quantity,
      i.unit_label,
      i.line_total as source_value,
      i.sort_order,
      s.type as service_type
    from public.treatment_proposal_items i
    join public.services s on s.id = i.service_id and s.user_id = i.user_id
    where i.proposal_version_id = v_version.id and i.user_id = v_user_id
  ), expanded as (
    select
      si.source_item_id,
      c.component_service_id as service_id,
      cs.name as service_name_snapshot,
      round(si.quantity * c.quantity, 3) as quantity_granted,
      'sessão'::text as unit_label_snapshot,
      si.source_value,
      (si.sort_order * 1000 + c.sort_order)::integer as expanded_sort_order,
      si.service_id as source_combo_service_id,
      si.service_name_snapshot as source_combo_name_snapshot,
      greatest(cs.price * c.quantity, 0)::numeric as weight
    from source_items si
    join public.service_combo_items c
      on c.user_id = v_user_id and c.combo_service_id = si.service_id
    join public.services cs
      on cs.id = c.component_service_id and cs.user_id = v_user_id
    where si.service_type = 'combo'

    union all

    select
      si.source_item_id,
      si.service_id,
      si.service_name_snapshot,
      round(si.quantity, 3),
      si.unit_label,
      si.source_value,
      (si.sort_order * 1000)::integer,
      null::uuid,
      null::text,
      1::numeric
    from source_items si
    where si.service_type <> 'combo'
       or not exists (
         select 1 from public.service_combo_items c
         where c.user_id = v_user_id and c.combo_service_id = si.service_id
       )
  ), weighted as (
    select
      e.*,
      sum(e.weight) over(partition by e.source_item_id) as total_weight,
      count(*) over(partition by e.source_item_id) as component_count,
      row_number() over(partition by e.source_item_id order by e.expanded_sort_order, e.service_id) as component_number
    from expanded e
  ), preliminary as (
    select
      w.*,
      case
        when w.source_combo_service_id is null then round(w.source_value, 2)
        when w.total_weight > 0 then round(w.source_value * w.weight / w.total_weight, 2)
        else round(w.source_value / greatest(w.component_count, 1), 2)
      end as preliminary_value
    from weighted w
  ), allocated as (
    select
      p.*,
      case
        when p.source_combo_service_id is not null and p.component_number = p.component_count then
          round(
            p.source_value - coalesce(
              sum(p.preliminary_value) over(
                partition by p.source_item_id
                order by p.expanded_sort_order, p.service_id
                rows between unbounded preceding and 1 preceding
              ), 0
            ), 2
          )
        else p.preliminary_value
      end as allocated_value
    from preliminary p
  )
  select
    v_user_id,
    v_package.id,
    a.service_id,
    a.service_name_snapshot,
    a.quantity_granted,
    a.unit_label_snapshot,
    greatest(a.allocated_value, 0),
    a.expanded_sort_order,
    a.source_combo_service_id,
    a.source_combo_name_snapshot
  from allocated a
  order by a.expanded_sort_order, a.service_id;

  return v_package;
exception when unique_violation then
  select * into v_existing from public.patient_packages where user_id=v_user_id and source_proposal_version_id=p_proposal_version_id;
  if found then return v_existing; end if;
  select * into v_existing from public.patient_packages where user_id=v_user_id and creation_idempotency_key=p_idempotency_key;
  if found then return v_existing; end if;
  raise;
end;
$$;

-- Manual/complimentary packages follow the same expansion rule.
create or replace function public.create_manual_package_v1(
  p_idempotency_key uuid,
  p_patient_id uuid,
  p_title text,
  p_source_type text,
  p_items jsonb,
  p_valid_from date default null,
  p_valid_until date default null,
  p_reason text default null,
  p_notes text default null
)
returns public.patient_packages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_package public.patient_packages;
  v_existing public.patient_packages;
  v_item_count integer;
  v_owned_count integer;
  v_total numeric(14,2);
begin
  if v_user_id is null then raise exception using errcode='P0001',message='PACKAGE_SESSION_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception using errcode='22023',message='PACKAGE_IDEMPOTENCY_REQUIRED'; end if;
  if p_patient_id is null then raise exception using errcode='22023',message='PACKAGE_PATIENT_REQUIRED'; end if;
  if nullif(btrim(p_title),'') is null then raise exception using errcode='22023',message='PACKAGE_TITLE_REQUIRED'; end if;
  if p_source_type not in ('manual','complimentary') then raise exception using errcode='22023',message='PACKAGE_MANUAL_SOURCE_INVALID'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception using errcode='22023',message='PACKAGE_REASON_REQUIRED'; end if;
  if p_valid_until is not null and p_valid_from is not null and p_valid_until < p_valid_from then raise exception using errcode='22023',message='PACKAGE_VALIDITY_INVALID'; end if;
  if jsonb_typeof(coalesce(p_items,'null'::jsonb)) <> 'array' or jsonb_array_length(p_items)=0 then raise exception using errcode='22023',message='PACKAGE_ITEMS_REQUIRED'; end if;

  select * into v_existing from public.patient_packages where user_id=v_user_id and creation_idempotency_key=p_idempotency_key;
  if found then return v_existing; end if;
  perform 1 from public.patients where id=p_patient_id and user_id=v_user_id;
  if not found then raise exception using errcode='P0001',message='PACKAGE_PATIENT_FORBIDDEN'; end if;

  if exists(
    select 1 from jsonb_to_recordset(p_items) as x(service_id uuid,quantity numeric,commercial_value numeric)
    where x.service_id is null or coalesce(x.quantity,0)<=0 or (x.commercial_value is not null and x.commercial_value<0)
  ) then raise exception using errcode='22023',message='PACKAGE_ITEM_INVALID'; end if;

  select count(*) into v_item_count from jsonb_to_recordset(p_items) as x(service_id uuid,quantity numeric,commercial_value numeric);
  if (select count(distinct x.service_id) from jsonb_to_recordset(p_items) as x(service_id uuid,quantity numeric,commercial_value numeric)) <> v_item_count then
    raise exception using errcode='22023',message='PACKAGE_DUPLICATE_SERVICE_ITEM';
  end if;

  select count(*) into v_owned_count
  from public.services s
  join jsonb_to_recordset(p_items) as x(service_id uuid,quantity numeric,commercial_value numeric) on x.service_id=s.id
  where s.user_id=v_user_id;
  if v_owned_count<>v_item_count then raise exception using errcode='P0001',message='PACKAGE_SERVICE_FORBIDDEN'; end if;

  select round(coalesce(sum(coalesce(x.commercial_value,s.price*x.quantity)),0),2) into v_total
  from jsonb_to_recordset(p_items) as x(service_id uuid,quantity numeric,commercial_value numeric)
  join public.services s on s.id=x.service_id and s.user_id=v_user_id;

  insert into public.patient_packages(
    user_id,patient_id,title_snapshot,source_type,status,commercial_total_snapshot,
    valid_from,valid_until,notes,creation_reason,creation_idempotency_key,created_by
  ) values (
    v_user_id,p_patient_id,btrim(p_title),p_source_type,'draft',v_total,
    p_valid_from,p_valid_until,p_notes,btrim(p_reason),p_idempotency_key,v_user_id
  ) returning * into v_package;

  insert into public.patient_package_items(
    user_id, package_id, service_id, service_name_snapshot, quantity_granted,
    unit_label_snapshot, commercial_value_snapshot, sort_order,
    source_combo_service_id, source_combo_name_snapshot
  )
  with source_items as (
    select
      e.ordinality::integer as source_item_id,
      s.id as service_id,
      s.name as service_name_snapshot,
      round((e.value->>'quantity')::numeric,3) as quantity,
      round(coalesce(nullif(e.value->>'commercial_value','')::numeric, s.price*(e.value->>'quantity')::numeric),2) as source_value,
      (e.ordinality::integer - 1) as sort_order,
      s.type as service_type
    from jsonb_array_elements(p_items) with ordinality as e(value,ordinality)
    join public.services s on s.id=(e.value->>'service_id')::uuid and s.user_id=v_user_id
  ), expanded as (
    select
      si.source_item_id,
      c.component_service_id as service_id,
      cs.name as service_name_snapshot,
      round(si.quantity * c.quantity,3) as quantity_granted,
      si.source_value,
      (si.sort_order * 1000 + c.sort_order)::integer as expanded_sort_order,
      si.service_id as source_combo_service_id,
      si.service_name_snapshot as source_combo_name_snapshot,
      greatest(cs.price * c.quantity,0)::numeric as weight
    from source_items si
    join public.service_combo_items c on c.user_id=v_user_id and c.combo_service_id=si.service_id
    join public.services cs on cs.id=c.component_service_id and cs.user_id=v_user_id
    where si.service_type='combo'

    union all

    select
      si.source_item_id,
      si.service_id,
      si.service_name_snapshot,
      si.quantity,
      si.source_value,
      (si.sort_order * 1000)::integer,
      null::uuid,
      null::text,
      1::numeric
    from source_items si
    where si.service_type<>'combo'
       or not exists(select 1 from public.service_combo_items c where c.user_id=v_user_id and c.combo_service_id=si.service_id)
  ), weighted as (
    select
      e.*,
      sum(e.weight) over(partition by e.source_item_id) as total_weight,
      count(*) over(partition by e.source_item_id) as component_count,
      row_number() over(partition by e.source_item_id order by e.expanded_sort_order,e.service_id) as component_number
    from expanded e
  ), preliminary as (
    select
      w.*,
      case
        when w.source_combo_service_id is null then round(w.source_value,2)
        when w.total_weight>0 then round(w.source_value*w.weight/w.total_weight,2)
        else round(w.source_value/greatest(w.component_count,1),2)
      end as preliminary_value
    from weighted w
  ), allocated as (
    select
      p.*,
      case
        when p.source_combo_service_id is not null and p.component_number=p.component_count then
          round(p.source_value-coalesce(sum(p.preliminary_value) over(
            partition by p.source_item_id
            order by p.expanded_sort_order,p.service_id
            rows between unbounded preceding and 1 preceding
          ),0),2)
        else p.preliminary_value
      end as allocated_value
    from preliminary p
  )
  select
    v_user_id,
    v_package.id,
    a.service_id,
    a.service_name_snapshot,
    a.quantity_granted,
    'sessão',
    greatest(a.allocated_value,0),
    a.expanded_sort_order,
    a.source_combo_service_id,
    a.source_combo_name_snapshot
  from allocated a
  order by a.expanded_sort_order,a.service_id;

  return v_package;
exception when unique_violation then
  select * into v_existing from public.patient_packages where user_id=v_user_id and creation_idempotency_key=p_idempotency_key;
  if found then return v_existing; end if;
  raise;
end;
$$;

-- Read model for Patient 360. Reversals are excluded from the live sequence, so
-- removing an erroneous attendance restores the credit and re-numbers the valid
-- clinical sequence instead of leaving a phantom session.
create or replace view public.procedure_treatment_sessions_v1
with (security_invoker = true)
as
with adjustments as (
  select user_id, package_item_id,
         coalesce(sum(quantity_delta) filter (where movement_type='adjustment'),0)::numeric(12,3) as adjustment_total
  from public.patient_credit_ledger
  group by user_id, package_item_id
), base as (
  select
    r.id as redemption_id,
    r.user_id,
    r.patient_id,
    r.package_id,
    p.title_snapshot as package_title,
    r.package_item_id,
    i.service_id,
    i.service_name_snapshot,
    i.source_combo_service_id,
    i.source_combo_name_snapshot,
    r.procedure_id_snapshot,
    r.procedure_item_id_snapshot,
    r.quantity,
    greatest(i.quantity_granted + coalesce(a.adjustment_total,0),0)::numeric(12,3) as session_total,
    r.created_at,
    exists(
      select 1
      from public.patient_credit_ledger l
      where l.user_id=r.user_id
        and l.movement_type='reversal'
        and l.source_type='procedure_reversal'
        and l.source_id=r.id
    ) as reversed
  from public.package_redemptions r
  join public.patient_package_items i on i.id=r.package_item_id and i.user_id=r.user_id
  join public.patient_packages p on p.id=r.package_id and p.user_id=r.user_id
  left join adjustments a on a.user_id=r.user_id and a.package_item_id=r.package_item_id
), valid as (
  select b.*,
    sum(b.quantity) over(
      partition by b.user_id,b.package_item_id
      order by b.created_at,b.redemption_id
      rows between unbounded preceding and current row
    )::numeric(12,3) as session_end
  from base b
  where not b.reversed
)
select
  v.redemption_id,
  v.user_id,
  v.patient_id,
  v.package_id,
  v.package_title,
  v.package_item_id,
  v.service_id,
  v.service_name_snapshot,
  v.source_combo_service_id,
  v.source_combo_name_snapshot,
  v.procedure_id_snapshot,
  v.procedure_item_id_snapshot,
  v.quantity,
  (v.session_end-v.quantity+1)::numeric(12,3) as session_start,
  v.session_end,
  v.session_total,
  v.created_at
from valid v;

grant select on public.procedure_treatment_sessions_v1 to authenticated;
revoke all on public.procedure_treatment_sessions_v1 from anon;
