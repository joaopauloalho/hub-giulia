drop policy if exists "patients_own" on public.patients;
create policy patients_own on public.patients for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "contacts: user owns" on public.contacts;
drop policy if exists contacts_own on public.contacts;
create policy contacts_own on public.contacts for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "deals: user owns" on public.deals;
drop policy if exists deals_own on public.deals;
create policy deals_own on public.deals for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "services: own rows" on public.services;
drop policy if exists services_own on public.services;
create policy services_own on public.services for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "appointments: own rows" on public.appointments;
drop policy if exists appointments_own on public.appointments;
create policy appointments_own on public.appointments for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "users see own procedures" on public.procedures;
drop policy if exists procedures_own on public.procedures;
create policy procedures_own on public.procedures for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists patient_photos_own on public.patient_photos;
create policy patient_photos_own on public.patient_photos for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists contract_templates_own on public.contract_templates;
create policy contract_templates_own on public.contract_templates for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists contracts_own on public.contracts;
create policy contracts_own on public.contracts for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists patient_notes_own on public.patient_notes;
create policy patient_notes_own on public.patient_notes for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
