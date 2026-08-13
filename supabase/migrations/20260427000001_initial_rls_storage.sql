-- Hub Giulia baseline security/storage state before the first 20260516 migration.

alter table public.contacts enable row level security;
alter table public.deals enable row level security;
alter table public.patients enable row level security;
alter table public.anamnesis enable row level security;
alter table public.patient_photos enable row level security;
alter table public.contract_templates enable row level security;
alter table public.contracts enable row level security;
alter table public.services enable row level security;
alter table public.appointments enable row level security;
alter table public.procedures enable row level security;
alter table public.pix_installments enable row level security;

drop policy if exists "contacts: user owns" on public.contacts;
create policy "contacts: user owns" on public.contacts for all using (auth.uid() = user_id);

drop policy if exists "deals: user owns" on public.deals;
create policy "deals: user owns" on public.deals for all using (auth.uid() = user_id);

drop policy if exists "patients_own" on public.patients;
create policy "patients_own" on public.patients for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "anamnesis_own" on public.anamnesis;
create policy "anamnesis_own" on public.anamnesis for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "patient_photos_own" on public.patient_photos;
create policy "patient_photos_own" on public.patient_photos for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "contract_templates_own" on public.contract_templates;
create policy "contract_templates_own" on public.contract_templates for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "contracts_own" on public.contracts;
create policy "contracts_own" on public.contracts for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "services: own rows" on public.services;
create policy "services: own rows" on public.services for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "appointments: own rows" on public.appointments;
create policy "appointments: own rows" on public.appointments for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "users see own procedures" on public.procedures;
create policy "users see own procedures" on public.procedures for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "users see own pix_installments" on public.pix_installments;
create policy "users see own pix_installments" on public.pix_installments for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values
  ('patient-photos', 'patient-photos', false),
  ('contracts', 'contracts', false)
on conflict (id) do update set public = excluded.public;
