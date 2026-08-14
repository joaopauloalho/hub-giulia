export type PackageSourceType = 'proposal' | 'manual' | 'voucher' | 'complimentary';
export type PackageEffectiveStatus = 'draft' | 'active' | 'completed' | 'expired' | 'voided';

export interface PatientEntitlement {
  user_id: string;
  patient_id: string;
  package_id: string;
  package_title: string;
  source_type: PackageSourceType;
  source_proposal_version_id: string | null;
  source_deal_id: string | null;
  source_voucher_id: string | null;
  package_status: 'draft' | 'active' | 'voided';
  valid_from: string | null;
  valid_until: string | null;
  activated_at: string | null;
  package_item_id: string;
  service_id: string | null;
  service_name_snapshot: string;
  quantity_granted: number;
  unit_label_snapshot: string;
  commercial_value_snapshot: number | null;
  granted: number;
  redeemed: number;
  reversed: number;
  adjusted: number;
  raw_balance: number;
  available_balance: number;
  effective_status: PackageEffectiveStatus;
}

export interface PatientPackageSummary {
  user_id: string;
  patient_id: string;
  package_id: string;
  package_title: string;
  source_type: PackageSourceType;
  source_proposal_version_id: string | null;
  source_deal_id: string | null;
  source_voucher_id: string | null;
  valid_from: string | null;
  valid_until: string | null;
  activated_at: string | null;
  item_count: number;
  quantity_granted: number;
  raw_balance: number;
  available_balance: number;
  effective_status: PackageEffectiveStatus;
}

export interface PackageLedgerMovement {
  id: string;
  patient_id: string;
  package_id: string;
  package_item_id: string;
  movement_type: 'grant' | 'redeem' | 'reversal' | 'adjustment';
  quantity_delta: number;
  source_type: string;
  source_id: string | null;
  procedure_id_snapshot: string | null;
  procedure_item_id_snapshot: string | null;
  reason: string | null;
  created_by: string;
  created_at: string;
}

export interface VoucherRecord {
  id: string;
  code: string;
  status: 'active' | 'redeemed' | 'voided';
  service_id: string | null;
  service_name_snapshot: string;
  quantity: number;
  unit_label_snapshot: string;
  recipient_name: string | null;
  recipient_phone: string | null;
  patient_id: string | null;
  issued_at: string;
  valid_until: string | null;
  redeemed_at: string | null;
  redeemed_by_patient_id: string | null;
  redeemed_package_id: string | null;
  source: string | null;
  note: string | null;
  voided_at: string | null;
  void_reason: string | null;
}

export interface PackageCoverageSelection {
  service_id: string;
  package_item_id: string;
  quantity: number;
}

export interface PackagePaymentEntry {
  method: 'dinheiro' | 'pix' | 'cartao_credito' | 'cartao_debito';
  base_amount: number;
  amount: number;
  card_brand?: 'master_visa' | 'elo' | null;
  installments?: number;
  fee_pct?: number | null;
  fee_value?: number | null;
  net_amount: number;
  absorve_taxa?: boolean;
  scheduled_date?: string | null;
}
