-- Protocolos clínicos podem continuar além da quantidade contratada sem gerar nova cobrança.
-- A quantidade contratada permanece imutável como referência comercial; extensões clínicas
-- são créditos técnicos separados e o protocolo só termina por finalização explícita.

alter table public.patient_packages
  add column if not exists allow_clinical_extensions boolean not null default false,
  add column if not exists clinically_finalized_at timestamptz,
  add column if not exists clinically_finalized_by uuid,
  add column if not exists clinically_finalized_reason text;

create or replace function public.mark_attendance_protocol_as_extendable_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.source_procedure_id is not null then
    new.allow_clinical_extensions := true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_patient_packages_mark_extendable on public.patient_packages;
create trigger trg_patient_packages_mark_extendable
before insert or update of source_procedure_id on public.patient_packages
for each row execute function public.mark_attendance_protocol_as_extendable_v1();

update public.patient_packages
set allow_clinical_extensions = true
where source_procedure_id is not null
  and allow_clinical_extensions is distinct from true;

-- Impede qualquer cliente desatualizado de consumir crédito depois da finalização clínica.
create or replace function public.guard_finalized_protocol_redemption_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_finalized_at timestamptz;
begin
  if new.movement_type <> 'redeem' then
    return new;
  end if;

  select p.clinically_finalized_at
    into v_finalized_at
  from public.patient_package_items i
  join public.patient_packages p
    on p.id = i.package_id and p.user_id = i.user_id
  where i.id = new.package_item_id
    and i.user_id = new.user_id;

  if v_finalized_at is not null then
    raise exception using errcode = 'P0001', message = 'PROTOCOL_CLINICALLY_FINALIZED';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_finalized_protocol_redemption on public.patient_credit_ledger;
create trigger trg_guard_finalized_protocol_redemption
before insert on public.patient_credit_ledger
for each row execute function public.guard_finalized_protocol_redemption_v1();

-- Mantém exatamente uma próxima sessão técnica disponível depois que a parte contratada acaba.
-- Esse crédito não altera o total contratado e só existe para permitir continuidade clínica sem cobrança.
create or replace function public.replenish_protocol_clinical_extension_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_package public.patient_packages;
  v_contracted_balance numeric(12,3);
  v_raw_balance numeric(12,3);
  v_target numeric(12,3);
  v_delta numeric(12,3);
begin
  if new.movement_type <> 'redeem' then
    return new;
  end if;

  select p.* into v_package
  from public.patient_packages p
  where p.id = new.package_id
    and p.user_id = new.user_id;

  if not found
     or not v_package.allow_clinical_extensions
     or v_package.status <> 'active'
     or v_package.clinically_finalized_at is not null
     or (v_package.valid_from is not null and v_package.valid_from > current_date)
     or (v_package.valid_until is not null and v_package.valid_until < current_date) then
    return new;
  end if;

  select
    coalesce(sum(case
      when movement_type = 'adjustment' and source_type = 'protocol_clinical_extension' then 0
      else quantity_delta
    end), 0)::numeric(12,3),
    coalesce(sum(quantity_delta), 0)::numeric(12,3)
  into v_contracted_balance, v_raw_balance
  from public.patient_credit_ledger
  where user_id = new.user_id
    and package_item_id = new.package_item_id;

  if v_contracted_balance > 0 then
    return new;
  end if;

  v_target := greatest(abs(new.quantity_delta), 0.001)::numeric(12,3);
  v_delta := round(v_target - v_raw_balance, 3);
  if v_delta <= 0 then
    return new;
  end if;

  insert into public.patient_credit_ledger(
    user_id, patient_id, package_id, package_item_id,
    movement_type, quantity_delta, source_type, source_id,
    procedure_id, procedure_item_id, procedure_id_snapshot, procedure_item_id_snapshot,
    reason, idempotency_key, created_by
  ) values (
    new.user_id, new.patient_id, new.package_id, new.package_item_id,
    'adjustment', v_delta, 'protocol_clinical_extension', new.procedure_id,
    new.procedure_id, new.procedure_item_id, new.procedure_id_snapshot, new.procedure_item_id_snapshot,
    'Reserva automática para continuidade clínica sem cobrança',
    'clinical-extension-reserve:' || new.id::text,
    new.created_by
  );

  return new;
end;
$$;

drop trigger if exists trg_replenish_protocol_clinical_extension on public.patient_credit_ledger;
create trigger trg_replenish_protocol_clinical_extension
after insert on public.patient_credit_ledger
for each row execute function public.replenish_protocol_clinical_extension_v1();

-- Protocolos já esgotados antes desta migration recebem a primeira sessão técnica de continuidade.
with balances as (
  select
    i.user_id,
    p.patient_id,
    p.id as package_id,
    i.id as package_item_id,
    coalesce(sum(case
      when l.movement_type = 'adjustment' and l.source_type = 'protocol_clinical_extension' then 0
      else l.quantity_delta
    end), 0)::numeric(12,3) as contracted_balance,
    coalesce(sum(l.quantity_delta), 0)::numeric(12,3) as raw_balance
  from public.patient_package_items i
  join public.patient_packages p on p.id = i.package_id and p.user_id = i.user_id
  left join public.patient_credit_ledger l on l.package_item_id = i.id and l.user_id = i.user_id
  where p.allow_clinical_extensions = true
    and p.status = 'active'
    and p.clinically_finalized_at is null
    and (p.valid_from is null or p.valid_from <= current_date)
    and (p.valid_until is null or p.valid_until >= current_date)
  group by i.user_id, p.patient_id, p.id, i.id
)
insert into public.patient_credit_ledger(
  user_id, patient_id, package_id, package_item_id,
  movement_type, quantity_delta, source_type, reason, idempotency_key, created_by
)
select
  b.user_id, b.patient_id, b.package_id, b.package_item_id,
  'adjustment', round(1 - b.raw_balance, 3), 'protocol_clinical_extension',
  'Reserva inicial para continuidade clínica sem cobrança',
  'clinical-extension-backfill:' || b.package_item_id::text,
  b.user_id
from balances b
where b.contracted_balance <= 0
  and b.raw_balance < 1
on conflict (user_id, idempotency_key) do nothing;

create or replace view public.patient_credit_item_balances_v as
select
  i.user_id,
  p.patient_id,
  p.id as package_id,
  p.title_snapshot as package_title,
  p.source_type,
  p.source_proposal_version_id,
  p.source_deal_id,
  p.source_voucher_id,
  p.status as package_status,
  p.valid_from,
  p.valid_until,
  p.activated_at,
  i.id as package_item_id,
  i.service_id,
  i.service_name_snapshot,
  i.quantity_granted,
  i.unit_label_snapshot,
  i.commercial_value_snapshot,
  coalesce(sum(case when l.movement_type = 'grant' then l.quantity_delta else 0 end), 0)::numeric(12,3) as granted,
  coalesce(-sum(case when l.movement_type = 'redeem' then l.quantity_delta else 0 end), 0)::numeric(12,3) as redeemed,
  coalesce(sum(case when l.movement_type = 'reversal' then l.quantity_delta else 0 end), 0)::numeric(12,3) as reversed,
  coalesce(sum(case when l.movement_type = 'adjustment' then l.quantity_delta else 0 end), 0)::numeric(12,3) as adjusted,
  coalesce(sum(l.quantity_delta), 0)::numeric(12,3) as raw_balance,
  case
    when p.status = 'active'
      and p.clinically_finalized_at is null
      and (p.valid_from is null or p.valid_from <= current_date)
      and (p.valid_until is null or p.valid_until >= current_date)
    then case
      when p.allow_clinical_extensions
        and coalesce(sum(case
          when l.movement_type = 'adjustment' and l.source_type = 'protocol_clinical_extension' then 0
          else l.quantity_delta
        end), 0) <= 0
      then 1::numeric(12,3)
      else greatest(coalesce(sum(l.quantity_delta), 0), 0)::numeric(12,3)
    end
    else 0::numeric(12,3)
  end as available_balance,
  case
    when p.status = 'voided' then 'voided'
    when p.status = 'draft' then 'draft'
    when p.valid_from is not null and p.valid_from > current_date then 'draft'
    when p.valid_until is not null and p.valid_until < current_date then 'expired'
    when p.clinically_finalized_at is not null then 'completed'
    when p.allow_clinical_extensions then 'active'
    when coalesce(sum(l.quantity_delta), 0) <= 0 then 'completed'
    else 'active'
  end as effective_status,
  p.allow_clinical_extensions,
  p.clinically_finalized_at,
  p.clinically_finalized_reason,
  coalesce(sum(case
    when l.movement_type = 'adjustment' and l.source_type <> 'protocol_clinical_extension' then l.quantity_delta
    else 0
  end), 0)::numeric(12,3) as contracted_adjusted,
  coalesce(sum(case
    when l.movement_type = 'adjustment' and l.source_type = 'protocol_clinical_extension' then l.quantity_delta
    else 0
  end), 0)::numeric(12,3) as clinical_extension_adjusted
from public.patient_package_items i
join public.patient_packages p on p.id = i.package_id and p.user_id = i.user_id
left join public.patient_credit_ledger l on l.package_item_id = i.id and l.user_id = i.user_id
group by
  i.user_id, p.patient_id, p.id, p.title_snapshot, p.source_type,
  p.source_proposal_version_id, p.source_deal_id, p.source_voucher_id,
  p.status, p.valid_from, p.valid_until, p.activated_at,
  i.id, i.service_id, i.service_name_snapshot, i.quantity_granted,
  i.unit_label_snapshot, i.commercial_value_snapshot,
  p.allow_clinical_extensions, p.clinically_finalized_at, p.clinically_finalized_reason;

-- Ajustar a previsão de sessões nunca incorpora créditos automáticos de continuidade clínica.
create or replace function public.set_patient_protocol_item_total_v1(
  p_package_item_id uuid,
  p_total numeric,
  p_reason text,
  p_idempotency_key uuid
)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_item public.patient_package_items;
  v_package public.patient_packages;
  v_adjusted numeric(12,3);
  v_completed numeric(12,3);
  v_current_total numeric(12,3);
  v_target numeric(12,3);
  v_delta numeric(12,3);
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'PROTOCOL_SESSION_REQUIRED';
  end if;
  if p_package_item_id is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'PROTOCOL_ITEM_REQUIRED';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'PROTOCOL_ADJUSTMENT_REASON_REQUIRED';
  end if;

  v_target := round(coalesce(p_total, 0), 3);
  if v_target <= 0 or v_target > 1000 then
    raise exception using errcode = '22023', message = 'PROTOCOL_TOTAL_INVALID';
  end if;

  select * into v_item
  from public.patient_package_items
  where id = p_package_item_id and user_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'PROTOCOL_ITEM_FORBIDDEN';
  end if;

  select * into v_package
  from public.patient_packages
  where id = v_item.package_id and user_id = v_user_id
  for update;
  if not found or v_package.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'PROTOCOL_NOT_ACTIVE';
  end if;
  if v_package.clinically_finalized_at is not null then
    raise exception using errcode = 'P0001', message = 'PROTOCOL_CLINICALLY_FINALIZED';
  end if;

  select
    coalesce(sum(quantity_delta) filter (
      where movement_type = 'adjustment' and source_type <> 'protocol_clinical_extension'
    ), 0)::numeric(12,3),
    greatest(
      coalesce(-sum(quantity_delta) filter (where movement_type = 'redeem'), 0)
      - coalesce(sum(quantity_delta) filter (where movement_type = 'reversal'), 0),
      0
    )::numeric(12,3)
  into v_adjusted, v_completed
  from public.patient_credit_ledger
  where user_id = v_user_id and package_item_id = v_item.id;

  v_current_total := round(v_item.quantity_granted + v_adjusted, 3);
  if v_target < v_completed then
    raise exception using errcode = '22023', message = 'PROTOCOL_TOTAL_BELOW_COMPLETED';
  end if;

  v_delta := round(v_target - v_current_total, 3);
  if v_delta = 0 then
    return v_target;
  end if;

  if exists (
    select 1 from public.patient_credit_ledger
    where user_id = v_user_id
      and idempotency_key = 'protocol-total:' || p_idempotency_key::text
  ) then
    return v_target;
  end if;

  insert into public.patient_credit_ledger(
    user_id, patient_id, package_id, package_item_id,
    movement_type, quantity_delta, source_type, reason,
    idempotency_key, created_by
  ) values (
    v_user_id, v_package.patient_id, v_package.id, v_item.id,
    'adjustment', v_delta, 'protocol_plan_adjustment', btrim(p_reason),
    'protocol-total:' || p_idempotency_key::text, v_user_id
  );

  return v_target;
end;
$$;

create or replace function public.finalize_patient_protocol_v1(p_package_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'PROTOCOL_SESSION_REQUIRED';
  end if;

  update public.patient_packages
  set clinically_finalized_at = now(),
      clinically_finalized_by = v_user_id,
      clinically_finalized_reason = nullif(btrim(p_reason), ''),
      updated_at = now()
  where id = p_package_id
    and user_id = v_user_id
    and status = 'active'
    and allow_clinical_extensions = true
    and clinically_finalized_at is null;

  if not found then
    raise exception using errcode = 'P0001', message = 'PROTOCOL_FINALIZE_FORBIDDEN';
  end if;
end;
$$;

create or replace function public.reopen_patient_protocol_v1(p_package_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'PROTOCOL_SESSION_REQUIRED';
  end if;

  update public.patient_packages
  set clinically_finalized_at = null,
      clinically_finalized_by = null,
      clinically_finalized_reason = null,
      updated_at = now()
  where id = p_package_id
    and user_id = v_user_id
    and status = 'active'
    and allow_clinical_extensions = true
    and clinically_finalized_at is not null;

  if not found then
    raise exception using errcode = 'P0001', message = 'PROTOCOL_REOPEN_FORBIDDEN';
  end if;
end;
$$;

revoke all on function public.finalize_patient_protocol_v1(uuid, text) from public, anon;
revoke all on function public.reopen_patient_protocol_v1(uuid) from public, anon;
grant execute on function public.finalize_patient_protocol_v1(uuid, text) to authenticated;
grant execute on function public.reopen_patient_protocol_v1(uuid) to authenticated;
