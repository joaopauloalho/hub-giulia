-- Hub Giulia 1.6 — Atendimento Atômico v2
-- One transaction for procedure + item snapshots + payments + injectable maps + appointment.
-- Existing rows remain compatible because idempotency columns are nullable.

alter table public.procedures
  add column if not exists idempotency_key uuid,
  add column if not exists idempotency_payload_hash text;

alter table public.procedures
  add constraint procedures_idempotency_pair_check
  check (
    (idempotency_key is null and idempotency_payload_hash is null)
    or (idempotency_key is not null and idempotency_payload_hash is not null)
  );

create unique index procedures_user_idempotency_key_uidx
  on public.procedures (user_id, idempotency_key)
  where idempotency_key is not null;

-- One appointment represents one completed attendance. Existing production data was
-- checked before this migration and contains no duplicate non-null appointment links.
create unique index procedures_user_appointment_once_uidx
  on public.procedures (user_id, appointment_id)
  where appointment_id is not null;

create or replace function public.create_procedure_v2(
  p_idempotency_key uuid,
  p_patient_id uuid,
  p_appointment_id uuid,
  p_performed_at timestamptz,
  p_items jsonb,
  p_payment_entries jsonb,
  p_injectable_maps jsonb,
  p_notes text
)
returns public.procedures
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_proc public.procedures;
  v_existing public.procedures;
  v_payload_hash text;
  v_item_count integer;
  v_owned_item_count integer;
  v_payment_count integer;
  v_total_value numeric := 0;
  v_total_cost numeric := 0;
  v_allocated_value numeric := 0;
  v_payment_method text;
  v_card_fee_pct numeric;
  v_card_fee_value numeric;
  v_immediate_net numeric := 0;
  v_appointment_patient_id uuid;
  v_appointment_status text;
begin
  if v_user_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'ATTENDANCE_SESSION_REQUIRED';
  end if;

  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'ATTENDANCE_IDEMPOTENCY_KEY_REQUIRED';
  end if;

  if p_patient_id is null then
    raise exception using errcode = '22023', message = 'ATTENDANCE_PATIENT_REQUIRED';
  end if;

  if p_performed_at is null then
    raise exception using errcode = '22023', message = 'ATTENDANCE_PERFORMED_AT_REQUIRED';
  end if;

  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = '22023', message = 'ATTENDANCE_ITEMS_REQUIRED';
  end if;

  if jsonb_typeof(coalesce(p_payment_entries, 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_payment_entries) = 0 then
    raise exception using errcode = '22023', message = 'ATTENDANCE_PAYMENTS_REQUIRED';
  end if;

  if p_injectable_maps is null then
    p_injectable_maps := '[]'::jsonb;
  end if;

  if jsonb_typeof(p_injectable_maps) <> 'array' then
    raise exception using errcode = '22023', message = 'ATTENDANCE_INJECTABLE_MAPS_INVALID';
  end if;

  -- jsonb text output is canonical for object key ordering, so the same request
  -- produces the same hash while a reused key with different data is rejected.
  v_payload_hash := md5(jsonb_build_object(
    'patient_id', p_patient_id,
    'appointment_id', p_appointment_id,
    'performed_at', p_performed_at,
    'items', p_items,
    'payment_entries', p_payment_entries,
    'injectable_maps', p_injectable_maps,
    'notes', p_notes
  )::text);

  select * into v_existing
  from public.procedures
  where user_id = v_user_id
    and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.idempotency_payload_hash <> v_payload_hash then
      raise exception using errcode = 'P0001', message = 'ATTENDANCE_IDEMPOTENCY_CONFLICT';
    end if;
    return v_existing;
  end if;

  perform 1
  from public.patients
  where id = p_patient_id
    and user_id = v_user_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'ATTENDANCE_PATIENT_FORBIDDEN';
  end if;

  -- Lock the appointment when present. This serializes concurrent submissions for
  -- the same agenda row and lets an equal idempotency retry return the first result.
  if p_appointment_id is not null then
    select patient_id, status
      into v_appointment_patient_id, v_appointment_status
    from public.appointments
    where id = p_appointment_id
      and user_id = v_user_id
    for update;

    if not found then
      raise exception using errcode = 'P0001', message = 'ATTENDANCE_APPOINTMENT_FORBIDDEN';
    end if;

    if v_appointment_patient_id <> p_patient_id then
      raise exception using errcode = 'P0001', message = 'ATTENDANCE_APPOINTMENT_PATIENT_MISMATCH';
    end if;

    -- A concurrent call with the same key may have committed while this one waited.
    select * into v_existing
    from public.procedures
    where user_id = v_user_id
      and idempotency_key = p_idempotency_key;

    if found then
      if v_existing.idempotency_payload_hash <> v_payload_hash then
        raise exception using errcode = 'P0001', message = 'ATTENDANCE_IDEMPOTENCY_CONFLICT';
      end if;
      return v_existing;
    end if;

    if exists (
      select 1 from public.procedures
      where user_id = v_user_id
        and appointment_id = p_appointment_id
    ) then
      raise exception using errcode = 'P0001', message = 'ATTENDANCE_APPOINTMENT_ALREADY_COMPLETED';
    end if;

    if v_appointment_status = 'cancelado' then
      raise exception using errcode = 'P0001', message = 'ATTENDANCE_APPOINTMENT_CANCELLED';
    end if;
  end if;

  -- Validate item shape before doing any write.
  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(
      service_id uuid,
      qty numeric,
      final_price numeric
    )
    where item.service_id is null
      or coalesce(item.qty, 1) <= 0
      or item.final_price is null
      or item.final_price < 0
  ) then
    raise exception using errcode = '22023', message = 'ATTENDANCE_ITEM_INVALID';
  end if;

  select count(*) into v_item_count
  from jsonb_to_recordset(p_items) as item(service_id uuid, qty numeric, final_price numeric);

  if (
    select count(distinct item.service_id)
    from jsonb_to_recordset(p_items) as item(service_id uuid, qty numeric, final_price numeric)
  ) <> v_item_count then
    raise exception using errcode = '22023', message = 'ATTENDANCE_DUPLICATE_SERVICE_ITEM';
  end if;

  select count(*) into v_owned_item_count
  from public.services s
  join jsonb_to_recordset(p_items) as item(service_id uuid, qty numeric, final_price numeric)
    on item.service_id = s.id
  where s.user_id = v_user_id;

  if v_owned_item_count <> v_item_count then
    raise exception using errcode = 'P0001', message = 'ATTENDANCE_SERVICE_FORBIDDEN';
  end if;

  select
    coalesce(sum(item.final_price), 0),
    coalesce(sum(s.cost_per_unit * coalesce(item.qty, 1)), 0)
  into v_total_value, v_total_cost
  from jsonb_to_recordset(p_items) as item(service_id uuid, qty numeric, final_price numeric)
  join public.services s
    on s.id = item.service_id
   and s.user_id = v_user_id;

  -- Validate payment payload and accounting before inserting the procedure.
  if exists (
    select 1
    from jsonb_to_recordset(p_payment_entries) as payment(
      method text,
      base_amount numeric,
      amount numeric,
      card_brand text,
      installments integer,
      fee_pct numeric,
      fee_value numeric,
      net_amount numeric,
      absorve_taxa boolean,
      scheduled_date date
    )
    where payment.method not in ('dinheiro', 'pix', 'cartao_credito', 'cartao_debito')
      or payment.base_amount is null or payment.base_amount < 0
      or payment.amount is null or payment.amount < 0
      or payment.net_amount is null or payment.net_amount < 0
      or coalesce(payment.installments, 1) < 1
      or (payment.fee_pct is not null and (payment.fee_pct < 0 or payment.fee_pct > 100))
      or (payment.fee_value is not null and payment.fee_value < 0)
      or abs(payment.amount - coalesce(payment.fee_value, 0) - payment.net_amount) > 0.02
      or (payment.method in ('cartao_credito', 'cartao_debito') and payment.card_brand not in ('master_visa', 'elo'))
      or (payment.method not in ('cartao_credito', 'cartao_debito') and payment.card_brand is not null)
      or (payment.method <> 'cartao_credito' and coalesce(payment.installments, 1) <> 1)
  ) then
    raise exception using errcode = '22023', message = 'ATTENDANCE_PAYMENT_INVALID';
  end if;

  select
    count(*),
    coalesce(sum(payment.base_amount), 0),
    case when count(*) = 1 then min(payment.method) else 'split' end,
    case when count(*) = 1 then min(payment.fee_pct) else null end,
    nullif(coalesce(sum(coalesce(payment.fee_value, 0)), 0), 0),
    coalesce(sum(
      case
        when payment.scheduled_date is null or payment.scheduled_date <= current_date
          then payment.net_amount
        else 0
      end
    ), 0)
  into
    v_payment_count,
    v_allocated_value,
    v_payment_method,
    v_card_fee_pct,
    v_card_fee_value,
    v_immediate_net
  from jsonb_to_recordset(p_payment_entries) as payment(
    method text,
    base_amount numeric,
    amount numeric,
    card_brand text,
    installments integer,
    fee_pct numeric,
    fee_value numeric,
    net_amount numeric,
    absorve_taxa boolean,
    scheduled_date date
  );

  if v_payment_count < 1 then
    raise exception using errcode = '22023', message = 'ATTENDANCE_PAYMENTS_REQUIRED';
  end if;

  if abs(v_allocated_value - v_total_value) > 0.02 then
    raise exception using errcode = '22023', message = 'ATTENDANCE_PAYMENT_TOTAL_MISMATCH';
  end if;

  -- Validate injectable maps without changing their existing points format.
  if exists (
    select 1
    from jsonb_array_elements(p_injectable_maps) as map(value)
    where jsonb_typeof(map.value) <> 'object'
       or jsonb_typeof(map.value -> 'points') <> 'array'
  ) then
    raise exception using errcode = '22023', message = 'ATTENDANCE_INJECTABLE_MAP_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_injectable_maps) as map(value)
    cross join lateral jsonb_array_elements(map.value -> 'points') as point(value)
    where nullif(point.value ->> 'service_id', '') is null
       or not exists (
         select 1
         from jsonb_to_recordset(p_items) as item(service_id uuid, qty numeric, final_price numeric)
         where item.service_id::text = point.value ->> 'service_id'
       )
  ) then
    raise exception using errcode = '22023', message = 'ATTENDANCE_INJECTABLE_SERVICE_MISMATCH';
  end if;

  -- Keep services_ids empty on INSERT so the legacy AFTER INSERT snapshot trigger
  -- does not duplicate procedure_items. Items are inserted explicitly below using
  -- authoritative service snapshots, then services_ids is populated for compatibility.
  begin
    insert into public.procedures (
      user_id,
      patient_id,
      appointment_id,
      performed_at,
      services_ids,
      total_value,
      total_cost,
      payment_method,
      card_fee_pct,
      card_fee_value,
      net_value,
      notes,
      idempotency_key,
      idempotency_payload_hash
    ) values (
      v_user_id,
      p_patient_id,
      p_appointment_id,
      p_performed_at,
      '[]'::jsonb,
      v_total_value,
      v_total_cost,
      v_payment_method,
      v_card_fee_pct,
      v_card_fee_value,
      v_immediate_net,
      p_notes,
      p_idempotency_key,
      v_payload_hash
    )
    returning * into v_proc;
  exception
    when unique_violation then
      select * into v_existing
      from public.procedures
      where user_id = v_user_id
        and idempotency_key = p_idempotency_key;

      if found then
        if v_existing.idempotency_payload_hash <> v_payload_hash then
          raise exception using errcode = 'P0001', message = 'ATTENDANCE_IDEMPOTENCY_CONFLICT';
        end if;
        return v_existing;
      end if;
      raise;
  end;

  insert into public.procedure_items (
    procedure_id,
    user_id,
    service_id,
    name,
    qty,
    list_price,
    final_price,
    discount,
    cost_snapshot
  )
  select
    v_proc.id,
    v_user_id,
    s.id,
    s.name,
    coalesce(item.qty, 1),
    s.price,
    item.final_price,
    greatest((s.price * coalesce(item.qty, 1)) - item.final_price, 0),
    s.cost_per_unit
  from jsonb_to_recordset(p_items) as item(service_id uuid, qty numeric, final_price numeric)
  join public.services s
    on s.id = item.service_id
   and s.user_id = v_user_id;

  update public.procedures
  set services_ids = (
    select coalesce(jsonb_agg(item.service_id order by item.ordinality), '[]'::jsonb)
    from jsonb_to_recordset(p_items) with ordinality as item(service_id uuid, qty numeric, final_price numeric, ordinality bigint)
  )
  where id = v_proc.id
    and user_id = v_user_id;

  insert into public.procedure_payments (
    procedure_id,
    user_id,
    method,
    amount,
    card_brand,
    installments,
    fee_pct,
    fee_value,
    net_amount,
    absorve_taxa,
    scheduled_date,
    paid_at
  )
  select
    v_proc.id,
    v_user_id,
    payment.method,
    payment.amount,
    payment.card_brand,
    coalesce(payment.installments, 1),
    payment.fee_pct,
    payment.fee_value,
    payment.net_amount,
    coalesce(payment.absorve_taxa, true),
    payment.scheduled_date,
    case
      when payment.scheduled_date is null or payment.scheduled_date <= current_date then now()
      else null
    end
  from jsonb_to_recordset(p_payment_entries) as payment(
    method text,
    base_amount numeric,
    amount numeric,
    card_brand text,
    installments integer,
    fee_pct numeric,
    fee_value numeric,
    net_amount numeric,
    absorve_taxa boolean,
    scheduled_date date
  );

  insert into public.injectable_maps (
    procedure_id,
    patient_id,
    user_id,
    points
  )
  select
    v_proc.id,
    p_patient_id,
    v_user_id,
    map.value -> 'points'
  from jsonb_array_elements(p_injectable_maps) as map(value);

  if p_appointment_id is not null then
    update public.appointments
    set status = 'realizado'
    where id = p_appointment_id
      and user_id = v_user_id
      and patient_id = p_patient_id;

    if not found then
      raise exception using errcode = 'P0001', message = 'ATTENDANCE_APPOINTMENT_UPDATE_FAILED';
    end if;
  end if;

  -- Return the final row after payment/item triggers have updated all rollups.
  select * into v_proc
  from public.procedures
  where id = v_proc.id
    and user_id = v_user_id;

  return v_proc;
end;
$function$;

revoke all on function public.create_procedure_v2(uuid, uuid, uuid, timestamptz, jsonb, jsonb, jsonb, text) from public;
revoke all on function public.create_procedure_v2(uuid, uuid, uuid, timestamptz, jsonb, jsonb, jsonb, text) from anon;
grant execute on function public.create_procedure_v2(uuid, uuid, uuid, timestamptz, jsonb, jsonb, jsonb, text) to authenticated;

comment on function public.create_procedure_v2(uuid, uuid, uuid, timestamptz, jsonb, jsonb, jsonb, text)
  is 'Atomic and idempotent attendance creation: procedure, item snapshots, payments, injectable maps, and appointment status.';
