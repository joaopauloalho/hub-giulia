-- Hub Giulia — partial receivables v1
-- Supports partial receipts without forcing a due date and keeps an open balance
-- that can be paid in any number of later receipts.

create or replace function public.create_procedure_v7(
  p_idempotency_key uuid,
  p_patient_id uuid,
  p_appointment_id uuid,
  p_performed_at timestamptz,
  p_items jsonb,
  p_payment_entries jsonb,
  p_injectable_maps jsonb,
  p_coverages jsonb,
  p_materials jsonb,
  p_clinical_minutes integer,
  p_notes text,
  p_barter_value numeric,
  p_barter_description text
)
returns public.procedures
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_pending_sentinel date := date '9999-12-31';
  v_payments jsonb := '[]'::jsonb;
  v_result public.procedures;
begin
  if v_user_id is null then
    raise exception using errcode='P0001', message='ATTENDANCE_SESSION_REQUIRED';
  end if;
  if jsonb_typeof(coalesce(p_payment_entries, '[]'::jsonb)) <> 'array' then
    raise exception using errcode='22023', message='ATTENDANCE_PAYMENTS_INVALID';
  end if;

  select coalesce(jsonb_agg(
    case
      when coalesce((entry->>'is_immediate')::boolean, true) = false
       and nullif(entry->>'scheduled_date', '') is null
      then jsonb_set(entry - 'is_immediate', '{scheduled_date}', to_jsonb(v_pending_sentinel))
      else entry - 'is_immediate'
    end
  ), '[]'::jsonb)
  into v_payments
  from jsonb_array_elements(coalesce(p_payment_entries, '[]'::jsonb)) as entry;

  select * into v_result
  from public.create_procedure_v6(
    p_idempotency_key,
    p_patient_id,
    p_appointment_id,
    p_performed_at,
    p_items,
    v_payments,
    coalesce(p_injectable_maps, '[]'::jsonb),
    coalesce(p_coverages, '[]'::jsonb),
    coalesce(p_materials, '[]'::jsonb),
    p_clinical_minutes,
    p_notes,
    p_barter_value,
    p_barter_description
  );

  update public.procedure_payments
  set scheduled_date = null
  where procedure_id = v_result.id
    and user_id = v_user_id
    and paid_at is null
    and scheduled_date = v_pending_sentinel;

  select * into v_result
  from public.procedures
  where id = v_result.id and user_id = v_user_id;

  return v_result;
end;
$function$;

revoke all on function public.create_procedure_v7(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb,integer,text,numeric,text) from public;
grant execute on function public.create_procedure_v7(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb,integer,text,numeric,text) to authenticated;

create or replace function public.create_procedure_with_injectable_draft_v7(
  p_idempotency_key uuid,
  p_patient_id uuid,
  p_appointment_id uuid,
  p_performed_at timestamptz,
  p_items jsonb,
  p_payment_entries jsonb,
  p_coverages jsonb,
  p_materials jsonb,
  p_clinical_minutes integer,
  p_notes text,
  p_draft_id uuid,
  p_draft_revision bigint,
  p_barter_value numeric,
  p_barter_description text
)
returns public.procedures
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_pending_sentinel date := date '9999-12-31';
  v_payments jsonb := '[]'::jsonb;
  v_result public.procedures;
begin
  if v_user_id is null then
    raise exception using errcode='P0001', message='ATTENDANCE_SESSION_REQUIRED';
  end if;
  if jsonb_typeof(coalesce(p_payment_entries, '[]'::jsonb)) <> 'array' then
    raise exception using errcode='22023', message='ATTENDANCE_PAYMENTS_INVALID';
  end if;

  select coalesce(jsonb_agg(
    case
      when coalesce((entry->>'is_immediate')::boolean, true) = false
       and nullif(entry->>'scheduled_date', '') is null
      then jsonb_set(entry - 'is_immediate', '{scheduled_date}', to_jsonb(v_pending_sentinel))
      else entry - 'is_immediate'
    end
  ), '[]'::jsonb)
  into v_payments
  from jsonb_array_elements(coalesce(p_payment_entries, '[]'::jsonb)) as entry;

  select * into v_result
  from public.create_procedure_with_injectable_draft_v6(
    p_idempotency_key,
    p_patient_id,
    p_appointment_id,
    p_performed_at,
    p_items,
    v_payments,
    coalesce(p_coverages, '[]'::jsonb),
    coalesce(p_materials, '[]'::jsonb),
    p_clinical_minutes,
    p_notes,
    p_draft_id,
    p_draft_revision,
    p_barter_value,
    p_barter_description
  );

  update public.procedure_payments
  set scheduled_date = null
  where procedure_id = v_result.id
    and user_id = v_user_id
    and paid_at is null
    and scheduled_date = v_pending_sentinel;

  select * into v_result
  from public.procedures
  where id = v_result.id and user_id = v_user_id;

  return v_result;
end;
$function$;

revoke all on function public.create_procedure_with_injectable_draft_v7(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,integer,text,uuid,bigint,numeric,text) from public;
grant execute on function public.create_procedure_with_injectable_draft_v7(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,integer,text,uuid,bigint,numeric,text) to authenticated;

create or replace function public.register_procedure_receipt_v1(
  p_procedure_id uuid,
  p_amount numeric,
  p_method text,
  p_paid_on date default current_date,
  p_card_brand text default null,
  p_installments integer default 1,
  p_absorve_taxa boolean default true,
  p_fee_pct numeric default 0
)
returns public.procedure_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_procedure public.procedures;
  v_pending public.procedure_payments;
  v_pending_total numeric(14,2) := 0;
  v_remaining numeric(14,2);
  v_take numeric(14,2);
  v_ratio numeric;
  v_base numeric(14,2) := round(coalesce(p_amount, 0), 2);
  v_fee_pct numeric(8,4) := round(coalesce(p_fee_pct, 0), 4);
  v_fee_value numeric(14,2) := 0;
  v_client_amount numeric(14,2) := 0;
  v_net_amount numeric(14,2) := 0;
  v_payment public.procedure_payments;
  v_method_count integer := 0;
  v_single_method text;
begin
  if v_user_id is null then
    raise exception using errcode='P0001', message='RECEIPT_SESSION_REQUIRED';
  end if;
  if p_procedure_id is null then
    raise exception using errcode='22023', message='RECEIPT_PROCEDURE_REQUIRED';
  end if;
  if v_base <= 0 then
    raise exception using errcode='22023', message='RECEIPT_AMOUNT_INVALID';
  end if;
  if p_paid_on is null or p_paid_on > current_date then
    raise exception using errcode='22023', message='RECEIPT_DATE_INVALID';
  end if;
  if p_method not in ('dinheiro','pix','cartao_credito','cartao_debito') then
    raise exception using errcode='22023', message='RECEIPT_METHOD_INVALID';
  end if;
  if v_fee_pct < 0 or v_fee_pct >= 100 then
    raise exception using errcode='22023', message='RECEIPT_FEE_INVALID';
  end if;
  if coalesce(p_installments, 1) < 1 then
    raise exception using errcode='22023', message='RECEIPT_INSTALLMENTS_INVALID';
  end if;
  if p_method in ('cartao_credito','cartao_debito') and p_card_brand not in ('master_visa','elo') then
    raise exception using errcode='22023', message='RECEIPT_CARD_BRAND_INVALID';
  end if;
  if p_method not in ('cartao_credito','cartao_debito') and p_card_brand is not null then
    raise exception using errcode='22023', message='RECEIPT_CARD_BRAND_INVALID';
  end if;
  if p_method <> 'cartao_credito' and coalesce(p_installments, 1) <> 1 then
    raise exception using errcode='22023', message='RECEIPT_INSTALLMENTS_INVALID';
  end if;

  select * into v_procedure
  from public.procedures
  where id = p_procedure_id and user_id = v_user_id
  for update;

  if not found then
    raise exception using errcode='P0001', message='RECEIPT_PROCEDURE_FORBIDDEN';
  end if;

  select round(coalesce(sum(pp.amount), 0), 2)
  into v_pending_total
  from public.procedure_payments pp
  where pp.procedure_id = p_procedure_id
    and pp.user_id = v_user_id
    and pp.paid_at is null;

  if v_pending_total <= 0.009 then
    raise exception using errcode='P0001', message='RECEIPT_NOTHING_PENDING';
  end if;
  if v_base > v_pending_total + 0.02 then
    raise exception using errcode='22023', message='RECEIPT_EXCEEDS_PENDING';
  end if;

  if p_method in ('cartao_credito','cartao_debito') and v_fee_pct > 0 then
    if coalesce(p_absorve_taxa, true) then
      v_client_amount := v_base;
      v_fee_value := round(v_base * v_fee_pct / 100, 2);
      v_net_amount := round(v_base - v_fee_value, 2);
    else
      v_net_amount := v_base;
      v_client_amount := round(v_base / (1 - v_fee_pct / 100), 2);
      v_fee_value := round(v_client_amount - v_net_amount, 2);
    end if;
  else
    v_client_amount := v_base;
    v_net_amount := v_base;
    v_fee_value := 0;
    v_fee_pct := 0;
  end if;

  v_remaining := v_base;

  for v_pending in
    select pp.*
    from public.procedure_payments pp
    where pp.procedure_id = p_procedure_id
      and pp.user_id = v_user_id
      and pp.paid_at is null
    order by pp.scheduled_date nulls last, pp.created_at, pp.id
    for update
  loop
    exit when v_remaining <= 0.009;
    v_take := least(v_remaining, round(v_pending.amount, 2));

    if v_take >= round(v_pending.amount, 2) - 0.009 then
      delete from public.procedure_payments where id = v_pending.id;
    else
      v_ratio := (v_pending.amount - v_take) / nullif(v_pending.amount, 0);
      update public.procedure_payments
      set amount = round(amount - v_take, 2),
          fee_value = case when fee_value is null then null else round(fee_value * v_ratio, 2) end,
          net_amount = round(net_amount * v_ratio, 2)
      where id = v_pending.id;
    end if;

    v_remaining := round(v_remaining - v_take, 2);
  end loop;

  if v_remaining > 0.02 then
    raise exception using errcode='P0001', message='RECEIPT_PENDING_ALLOCATION_FAILED';
  end if;

  insert into public.procedure_payments(
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
  values(
    p_procedure_id,
    v_user_id,
    p_method,
    v_client_amount,
    case when p_method in ('cartao_credito','cartao_debito') then p_card_brand else null end,
    case when p_method = 'cartao_credito' then coalesce(p_installments, 1) else 1 end,
    nullif(v_fee_pct, 0),
    nullif(v_fee_value, 0),
    v_net_amount,
    coalesce(p_absorve_taxa, true),
    p_paid_on,
    now()
  )
  returning * into v_payment;

  select count(distinct pp.method), min(pp.method)
  into v_method_count, v_single_method
  from public.procedure_payments pp
  where pp.procedure_id = p_procedure_id
    and pp.user_id = v_user_id
    and pp.paid_at is not null;

  update public.procedures p
  set payment_method = case when v_method_count > 1 then 'split' else coalesce(v_single_method, p.payment_method) end,
      card_fee_value = nullif((
        select round(coalesce(sum(coalesce(pp.fee_value, 0)), 0), 2)
        from public.procedure_payments pp
        where pp.procedure_id = p.id and pp.user_id = v_user_id and pp.paid_at is not null
      ), 0),
      net_value = (
        select round(coalesce(sum(pp.net_amount), 0), 2)
        from public.procedure_payments pp
        where pp.procedure_id = p.id and pp.user_id = v_user_id and pp.paid_at is not null
      )
  where p.id = p_procedure_id and p.user_id = v_user_id;

  return v_payment;
end;
$function$;

revoke all on function public.register_procedure_receipt_v1(uuid,numeric,text,date,text,integer,boolean,numeric) from public;
grant execute on function public.register_procedure_receipt_v1(uuid,numeric,text,date,text,integer,boolean,numeric) to authenticated;

create or replace function public.list_open_receivables_v1(p_patient_id uuid default null)
returns table(
  procedure_id uuid,
  patient_id uuid,
  patient_name text,
  performed_at timestamptz,
  total_value numeric,
  received_amount numeric,
  pending_amount numeric,
  service_names text,
  next_due_date date,
  pending_entries bigint,
  last_payment_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select
    p.id as procedure_id,
    p.patient_id,
    pt.name as patient_name,
    p.performed_at,
    p.total_value,
    coalesce(p.paid_amount, 0) as received_amount,
    coalesce(p.pending_amount, 0) as pending_amount,
    coalesce((
      select string_agg(pi.name, ', ' order by pi.created_at, pi.id)
      from public.procedure_items pi
      where pi.procedure_id = p.id and pi.user_id = auth.uid()
    ), 'Atendimento') as service_names,
    (
      select min(pp.scheduled_date)
      from public.procedure_payments pp
      where pp.procedure_id = p.id and pp.user_id = auth.uid() and pp.paid_at is null
    ) as next_due_date,
    (
      select count(*)
      from public.procedure_payments pp
      where pp.procedure_id = p.id and pp.user_id = auth.uid() and pp.paid_at is null
    ) as pending_entries,
    (
      select max(pp.paid_at)
      from public.procedure_payments pp
      where pp.procedure_id = p.id and pp.user_id = auth.uid() and pp.paid_at is not null
    ) as last_payment_at
  from public.procedures p
  join public.patients pt
    on pt.id = p.patient_id
   and pt.user_id = auth.uid()
  where p.user_id = auth.uid()
    and coalesce(p.pending_amount, 0) > 0.009
    and (p_patient_id is null or p.patient_id = p_patient_id)
  order by
    case when (
      select min(pp.scheduled_date)
      from public.procedure_payments pp
      where pp.procedure_id = p.id and pp.user_id = auth.uid() and pp.paid_at is null
    ) is null then 1 else 0 end,
    (
      select min(pp.scheduled_date)
      from public.procedure_payments pp
      where pp.procedure_id = p.id and pp.user_id = auth.uid() and pp.paid_at is null
    ),
    p.performed_at desc,
    p.id;
$function$;

revoke all on function public.list_open_receivables_v1(uuid) from public;
grant execute on function public.list_open_receivables_v1(uuid) to authenticated;

comment on function public.register_procedure_receipt_v1(uuid,numeric,text,date,text,integer,boolean,numeric) is
  'Registers an arbitrary partial receipt against an open procedure balance, preserving payment history and reducing the remaining receivable.';

comment on function public.list_open_receivables_v1(uuid) is
  'Lists open receivables across all dates, optionally filtered to one patient.';
