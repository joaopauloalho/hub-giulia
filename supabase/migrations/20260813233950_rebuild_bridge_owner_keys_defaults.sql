-- Rebuild bridge for the exact DDL recorded as applied in production migration
-- 20260813233949_security_owner_keys_defaults.
--
-- Production already has every object/default below. This file exists so a clean
-- database reconstructed from Git can receive the DDL before the following
-- composite-FK migrations. Do not remove without a successful clean rebuild and
-- a deliberate migration-history reconciliation.

create unique index if not exists patients_id_user_id_uidx on public.patients (id, user_id);
create unique index if not exists contacts_id_user_id_uidx on public.contacts (id, user_id);
create unique index if not exists services_id_user_id_uidx on public.services (id, user_id);
create unique index if not exists appointments_id_user_id_uidx on public.appointments (id, user_id);
create unique index if not exists procedures_id_user_id_uidx on public.procedures (id, user_id);
create unique index if not exists procedure_items_id_user_id_uidx on public.procedure_items (id, user_id);
create unique index if not exists contract_templates_id_user_id_uidx on public.contract_templates (id, user_id);

alter table public.patients alter column user_id set default auth.uid();
alter table public.contacts alter column user_id set default auth.uid();
alter table public.deals alter column user_id set default auth.uid();
alter table public.appointments alter column user_id set default auth.uid();
alter table public.services alter column user_id set default auth.uid();
alter table public.procedures alter column user_id set default auth.uid();
alter table public.procedure_items alter column user_id set default auth.uid();
alter table public.procedure_payments alter column user_id set default auth.uid();
alter table public.pix_installments alter column user_id set default auth.uid();
alter table public.injectable_maps alter column user_id set default auth.uid();
alter table public.patient_notes alter column user_id set default auth.uid();
alter table public.patient_photos alter column user_id set default auth.uid();
alter table public.contracts alter column user_id set default auth.uid();
alter table public.contract_templates alter column user_id set default auth.uid();
alter table public.procedure_returns alter column user_id set default auth.uid();
alter table public.maquininha_configs alter column user_id set default auth.uid();
