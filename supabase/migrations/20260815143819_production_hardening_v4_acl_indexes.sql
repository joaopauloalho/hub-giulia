-- Hub Giulia 4.0 production hardening: least privilege + FK support indexes.
-- Applied to production as Supabase migration 20260815143819.
-- No clinical or financial rows are modified by this migration.

REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_package_payments_package_owner_fk ON public.package_payments (package_id, user_id);
CREATE INDEX IF NOT EXISTS idx_package_redemptions_item_owner_fk ON public.package_redemptions (package_item_id, user_id);
CREATE INDEX IF NOT EXISTS idx_package_redemptions_ledger_owner_fk ON public.package_redemptions (ledger_movement_id, user_id);
CREATE INDEX IF NOT EXISTS idx_package_redemptions_package_owner_fk ON public.package_redemptions (package_id, user_id);
CREATE INDEX IF NOT EXISTS idx_package_redemptions_patient_owner_fk ON public.package_redemptions (patient_id, user_id);
CREATE INDEX IF NOT EXISTS idx_patient_credit_ledger_created_by_fk ON public.patient_credit_ledger (created_by);
CREATE INDEX IF NOT EXISTS idx_patient_credit_ledger_item_owner_fk ON public.patient_credit_ledger (package_item_id, user_id);
CREATE INDEX IF NOT EXISTS idx_patient_credit_ledger_package_owner_fk ON public.patient_credit_ledger (package_id, user_id);
CREATE INDEX IF NOT EXISTS idx_patient_credit_ledger_patient_owner_fk ON public.patient_credit_ledger (patient_id, user_id);
CREATE INDEX IF NOT EXISTS idx_patient_package_items_package_owner_fk ON public.patient_package_items (package_id, user_id);
CREATE INDEX IF NOT EXISTS idx_patient_package_items_service_owner_fk ON public.patient_package_items (service_id, user_id);
CREATE INDEX IF NOT EXISTS idx_patient_packages_created_by_fk ON public.patient_packages (created_by);
CREATE INDEX IF NOT EXISTS idx_patient_packages_deal_owner_fk ON public.patient_packages (source_deal_id, user_id);
CREATE INDEX IF NOT EXISTS idx_patient_packages_patient_owner_fk ON public.patient_packages (patient_id, user_id);
CREATE INDEX IF NOT EXISTS idx_patient_packages_proposal_version_owner_fk ON public.patient_packages (source_proposal_version_id, user_id);
CREATE INDEX IF NOT EXISTS idx_patient_packages_voucher_owner_fk ON public.patient_packages (source_voucher_id, user_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_created_by_fk ON public.vouchers (created_by);
CREATE INDEX IF NOT EXISTS idx_vouchers_redeemed_package_owner_fk ON public.vouchers (redeemed_package_id, user_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_redeemed_patient_owner_fk ON public.vouchers (redeemed_by_patient_id, user_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_service_owner_fk ON public.vouchers (service_id, user_id);
