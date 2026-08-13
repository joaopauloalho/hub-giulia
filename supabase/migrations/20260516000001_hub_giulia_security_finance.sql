-- Hub Giulia hardening notes:
-- 1. Set the Storage buckets `patient-photos` and `contracts` to private.
-- 2. Existing patient_photos.photo_url and contracts.pdf_url values should store object paths,
--    for example: <user_id>/<patient_id>/<file>.pdf. New app writes already use paths.

create table if not exists public.maquininha_configs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  credito_pct numeric(5,2) not null default 3 check (credito_pct >= 0 and credito_pct <= 100),
  debito_pct numeric(5,2) not null default 1.5 check (debito_pct >= 0 and debito_pct <= 100),
  updated_at timestamptz not null default now()
);

alter table public.maquininha_configs enable row level security;

drop policy if exists "maquininha_configs_select_own" on public.maquininha_configs;
create policy "maquininha_configs_select_own"
on public.maquininha_configs
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "maquininha_configs_insert_own" on public.maquininha_configs;
create policy "maquininha_configs_insert_own"
on public.maquininha_configs
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "maquininha_configs_update_own" on public.maquininha_configs;
create policy "maquininha_configs_update_own"
on public.maquininha_configs
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "patient_photos_read_own_folder" on storage.objects;
create policy "patient_photos_read_own_folder"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'patient-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "patient_photos_write_own_folder" on storage.objects;
create policy "patient_photos_write_own_folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'patient-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "patient_photos_delete_own_folder" on storage.objects;
create policy "patient_photos_delete_own_folder"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'patient-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "contracts_read_own_folder" on storage.objects;
create policy "contracts_read_own_folder"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'contracts'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "contracts_write_own_folder" on storage.objects;
create policy "contracts_write_own_folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'contracts'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "contracts_update_own_folder" on storage.objects;
create policy "contracts_update_own_folder"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'contracts'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'contracts'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create or replace function public.create_procedure_with_pix_installments(
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
  p_pix_installments_count integer
)
returns public.procedures
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_proc public.procedures;
  v_base numeric;
  v_num integer;
begin
  if v_user_id is null then
    raise exception 'Usuário não autenticado';
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

  if p_payment_method = 'pix_parcelado' and p_pix_installments_count >= 2 then
    v_base := round(p_total_value / p_pix_installments_count, 2);

    for v_num in 1..p_pix_installments_count loop
      insert into public.pix_installments (
        user_id,
        procedure_id,
        installment_num,
        total_installments,
        amount,
        due_date,
        paid_at,
        reminded_at
      )
      values (
        v_user_id,
        v_proc.id,
        v_num,
        p_pix_installments_count,
        case
          when v_num = p_pix_installments_count then p_total_value - (v_base * (p_pix_installments_count - 1))
          else v_base
        end,
        (current_date + (v_num || ' months')::interval)::date,
        null,
        null
      );
    end loop;
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

grant execute on function public.create_procedure_with_pix_installments(
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
  integer
) to authenticated;
