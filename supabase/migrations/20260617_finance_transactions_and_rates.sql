-- Align card machine config with the app model and move critical finance
-- mutations behind transactional RPCs.

alter table public.maquininha_configs
  add column if not exists rates jsonb;

alter table public.maquininha_configs
  alter column rates set default '{
    "pix": 0.50,
    "master_visa": {
      "debito": 1.39,
      "1": 2.93, "2": 4.36, "3": 5.13, "4": 5.89, "5": 6.63,
      "6": 7.37, "7": 7.97, "8": 8.69, "9": 9.41, "10": 10.11,
      "11": 10.82, "12": 11.51, "13": 12.20, "14": 12.88, "15": 13.55,
      "16": 14.22, "17": 14.88, "18": 15.53
    },
    "elo": {
      "debito": 1.45,
      "1": 3.24, "2": 4.56, "3": 5.33, "4": 6.09, "5": 6.83,
      "6": 7.57, "7": 8.17, "8": 8.89, "9": 9.61, "10": 10.31,
      "11": 11.02, "12": 11.71, "13": 12.40, "14": 13.08, "15": 13.75,
      "16": 14.42, "17": 15.08, "18": 15.73
    }
  }'::jsonb;

update public.maquininha_configs
set rates = jsonb_build_object(
  'pix', 0.50,
  'master_visa', jsonb_build_object(
    'debito', coalesce(debito_pct, 1.39),
    '1', coalesce(credito_pct, 2.93), '2', 4.36, '3', 5.13, '4', 5.89, '5', 6.63,
    '6', 7.37, '7', 7.97, '8', 8.69, '9', 9.41, '10', 10.11,
    '11', 10.82, '12', 11.51, '13', 12.20, '14', 12.88, '15', 13.55,
    '16', 14.22, '17', 14.88, '18', 15.53
  ),
  'elo', jsonb_build_object(
    'debito', coalesce(debito_pct, 1.45),
    '1', coalesce(credito_pct, 3.24), '2', 4.56, '3', 5.33, '4', 6.09, '5', 6.83,
    '6', 7.57, '7', 8.17, '8', 8.89, '9', 9.61, '10', 10.31,
    '11', 11.02, '12', 11.71, '13', 12.40, '14', 13.08, '15', 13.75,
    '16', 14.42, '17', 15.08, '18', 15.73
  )
)
where rates is null;

alter table public.maquininha_configs
  alter column rates set not null;

create table if not exists public.procedure_payments (
  id uuid primary key default gen_random_uuid(),
  procedure_id uuid not null references public.procedures(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  method text not null,
  amount numeric not null check (amount >= 0),
  card_brand text,
  installments integer not null default 1 check (installments >= 1),
  fee_pct numeric,
  fee_value numeric,
  net_amount numeric not null default 0,
  absorve_taxa boolean not null default true,
  scheduled_date date,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.procedure_payments enable row level security;

drop policy if exists "procedure_payments_select_own" on public.procedure_payments;
create policy "procedure_payments_select_own"
on public.procedure_payments
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "procedure_payments_insert_own" on public.procedure_payments;
create policy "procedure_payments_insert_own"
on public.procedure_payments
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.procedures
    where procedures.id = procedure_payments.procedure_id
      and procedures.user_id = auth.uid()
  )
);

drop policy if exists "procedure_payments_update_own" on public.procedure_payments;
create policy "procedure_payments_update_own"
on public.procedure_payments
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "procedure_payments_delete_own" on public.procedure_payments;
create policy "procedure_payments_delete_own"
on public.procedure_payments
for delete
to authenticated
using (user_id = auth.uid());

create or replace function public.create_procedure_with_payments(
  p_patient_id uuid,
  p_appointment_id uuid,
  p_performed_at timestamptz,
  p_services_ids jsonb,
  p_total_value numeric,
  p_total_cost numeric,
  p_payment_method text,
  p_card_fee_pct numeric,
  p_card_fee_value numeric,
  p_net_value numeric,
  p_notes text,
  p_payment_entries jsonb
)
returns public.procedures
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_proc public.procedures;
begin
  if v_user_id is null then
    raise exception 'Usuario nao autenticado';
  end if;

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
    notes
  )
  values (
    v_user_id,
    p_patient_id,
    p_appointment_id,
    coalesce(p_performed_at, now()),
    p_services_ids,
    p_total_value,
    p_total_cost,
    p_payment_method,
    p_card_fee_pct,
    p_card_fee_value,
    p_net_value,
    p_notes
  )
  returning * into v_proc;

  if p_payment_entries is not null and jsonb_array_length(p_payment_entries) > 0 then
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
      entry.method,
      entry.amount,
      entry.card_brand,
      coalesce(entry.installments, 1),
      entry.fee_pct,
      entry.fee_value,
      entry.net_amount,
      coalesce(entry.absorve_taxa, true),
      entry.scheduled_date,
      case when coalesce(entry.is_immediate, false) then now() else null end
    from jsonb_to_recordset(p_payment_entries) as entry(
      method text,
      amount numeric,
      card_brand text,
      installments integer,
      fee_pct numeric,
      fee_value numeric,
      net_amount numeric,
      absorve_taxa boolean,
      scheduled_date date,
      is_immediate boolean
    );
  end if;

  if p_appointment_id is not null then
    update public.appointments
    set status = 'realizado'
    where id = p_appointment_id
      and user_id = v_user_id;
  end if;

  return v_proc;
end;
$$;

grant execute on function public.create_procedure_with_payments(
  uuid,
  uuid,
  timestamptz,
  jsonb,
  numeric,
  numeric,
  text,
  numeric,
  numeric,
  numeric,
  text,
  jsonb
) to authenticated;

create or replace function public.remove_procedure_cascade(p_procedure_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_appointment_id uuid;
begin
  if v_user_id is null then
    raise exception 'Usuario nao autenticado';
  end if;

  select appointment_id
  into v_appointment_id
  from public.procedures
  where id = p_procedure_id
    and user_id = v_user_id;

  if not found then
    raise exception 'Atendimento nao encontrado';
  end if;

  update public.patient_photos
  set procedure_id = null
  where procedure_id = p_procedure_id
    and user_id = v_user_id;

  update public.injectable_maps
  set procedure_id = null
  where procedure_id = p_procedure_id
    and user_id = v_user_id;

  delete from public.procedure_payments
  where procedure_id = p_procedure_id
    and user_id = v_user_id;

  delete from public.pix_installments
  where procedure_id = p_procedure_id
    and user_id = v_user_id;

  delete from public.procedures
  where id = p_procedure_id
    and user_id = v_user_id;

  if v_appointment_id is not null then
    update public.appointments
    set status = 'confirmado'
    where id = v_appointment_id
      and user_id = v_user_id;
  end if;
end;
$$;

grant execute on function public.remove_procedure_cascade(uuid) to authenticated;
