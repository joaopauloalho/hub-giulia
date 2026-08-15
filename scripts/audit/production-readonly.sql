-- Hub Giulia 4.0 read-only production audit queries.
-- Run only with an approved authenticated/administrative SQL connection.
-- This script returns counts/invariants only; it intentionally does not select PHI.

-- Dataset size by critical domain.
select
  (select count(*) from public.patients) as patients,
  (select count(*) from public.procedures) as procedures,
  (select count(*) from public.procedure_payments) as payments,
  (select count(*) from public.appointments) as appointments,
  (select count(*) from public.patient_photos) as photos,
  (select count(*) from public.contracts) as contracts,
  (select count(*) from public.procedure_returns) as returns,
  (select count(*) from public.patient_packages) as packages,
  (select count(*) from public.treatment_proposals) as proposals,
  (select count(*) from public.procedure_followup_plans) as aftercare_plans;

-- Financial invariants: every value below should remain zero unless semantics are deliberately changed.
select
  (select count(*) from public.procedure_payments where amount < 0 or fee_value < 0 or net_amount < 0) as invalid_payments,
  (select count(*) from public.procedure_items where qty <= 0 or list_price < 0 or final_price < 0 or cost_snapshot < 0) as invalid_procedure_items,
  (select count(*) from public.package_redemptions where quantity <= 0 or coverage_value_snapshot < 0) as invalid_redemptions,
  (select count(*) from public.patient_credit_ledger where quantity_delta = 0) as zero_ledger_movements,
  (select count(*) from public.procedures p where coalesce(p.paid_amount,0) <> coalesce((select sum(pp.amount) from public.procedure_payments pp where pp.procedure_id=p.id and pp.user_id=p.user_id),0)) as procedure_paid_rollup_mismatches,
  (select count(*) from public.package_redemptions r left join public.patient_credit_ledger l on l.id=r.ledger_movement_id and l.user_id=r.user_id where l.id is null) as redemption_without_ledger;

-- Clinical history invariants.
with av as (
  select anamnesis_id, max(version_number) as max_version
  from public.anamnesis_versions
  group by anamnesis_id
)
select
  (select count(*) from public.anamnesis a where a.status='finalized' and not exists (select 1 from public.anamnesis_versions v where v.anamnesis_id=a.id)) as finalized_anamnesis_without_version,
  (select count(*) from public.anamnesis a join av on av.anamnesis_id=a.id where a.latest_version_number <> av.max_version) as anamnesis_latest_version_mismatch,
  (select count(*) from public.patient_photos where source_type='v2' and (original_path is null or sha256 is null or size_bytes is null or canonicalized_at is null)) as canonical_photo_metadata_missing,
  (select count(*) from public.patient_photos where voided_at is not null and nullif(btrim(void_reason),'') is null) as voided_photo_without_reason,
  (select count(*) from public.contracts where status='finalized' and (content_sha256 is null or signature_sha256 is null or pdf_sha256 is null or rendered_content_snapshot is null)) as finalized_contract_integrity_missing,
  (select count(*) from public.injectable_maps where status='finalized' and (finalized_at is null or procedure_id is null or finalization_key is null)) as finalized_injectable_inconsistent;

-- RLS / anonymous access invariants.
select
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity) as public_tables_without_rls,
  (select count(*) from information_schema.tables t where t.table_schema='public' and t.table_type='BASE TABLE' and (
    has_table_privilege('anon',format('public.%I',t.table_name),'SELECT') or
    has_table_privilege('anon',format('public.%I',t.table_name),'INSERT') or
    has_table_privilege('anon',format('public.%I',t.table_name),'UPDATE') or
    has_table_privilege('anon',format('public.%I',t.table_name),'DELETE')
  )) as anon_crud_tables,
  (select count(*) from information_schema.tables t where t.table_schema='public' and t.table_type='BASE TABLE' and (
    has_table_privilege('authenticated',format('public.%I',t.table_name),'TRUNCATE') or
    has_table_privilege('authenticated',format('public.%I',t.table_name),'TRIGGER') or
    has_table_privilege('authenticated',format('public.%I',t.table_name),'REFERENCES')
  )) as authenticated_ddl_style_grants;

-- Storage privacy/object counts only; no object names are returned.
select b.id as bucket_id, b.public, count(o.id) as object_count
from storage.buckets b
left join storage.objects o on o.bucket_id=b.id
where b.id in ('patient-photos','contracts','proposals')
group by b.id,b.public
order by b.id;

-- Migration history summary only.
select count(*) as applied_migrations, min(version) as first_version, max(version) as last_version
from supabase_migrations.schema_migrations;
