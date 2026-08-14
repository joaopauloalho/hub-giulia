-- Hub Giulia 2.2 — Contratos 2.0 / FK covering indexes
-- These indexes cover the exact foreign-key column order used by ownership and
-- template-version integrity checks. They also avoid full scans on parent updates/deletes.

create index if not exists contract_template_versions_created_by_idx
  on public.contract_template_versions(created_by);

create index if not exists contract_template_versions_template_owner_idx
  on public.contract_template_versions(template_id, user_id);

create index if not exists contract_templates_current_version_idx
  on public.contract_templates(current_version_id)
  where current_version_id is not null;

create index if not exists contracts_appointment_owner_v2_idx
  on public.contracts(appointment_id, user_id)
  where appointment_id is not null;

create index if not exists contracts_procedure_owner_v2_idx
  on public.contracts(procedure_id, user_id)
  where procedure_id is not null;

create index if not exists contracts_template_version_owner_v2_idx
  on public.contracts(template_version_id, template_id, user_id)
  where template_version_id is not null;
