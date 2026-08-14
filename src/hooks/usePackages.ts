import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import type {
  PackageLedgerMovement,
  PackagePaymentEntry,
  PatientEntitlement,
  PatientPackageSummary,
  VoucherRecord,
} from '../types/packages';

const numberFields = [
  'quantity_granted',
  'commercial_value_snapshot',
  'granted',
  'redeemed',
  'reversed',
  'adjusted',
  'raw_balance',
  'available_balance',
] as const;

function normalizeEntitlement(row: any): PatientEntitlement {
  const next = { ...row } as any;
  for (const field of numberFields) {
    if (next[field] != null) next[field] = Number(next[field]);
  }
  return next as PatientEntitlement;
}

function normalizeSummary(row: any): PatientPackageSummary {
  return {
    ...row,
    item_count: Number(row.item_count ?? 0),
    quantity_granted: Number(row.quantity_granted ?? 0),
    raw_balance: Number(row.raw_balance ?? 0),
    available_balance: Number(row.available_balance ?? 0),
  } as PatientPackageSummary;
}

export async function fetchPatientEntitlements(patientId: string, serviceIds?: string[]) {
  let query = supabase
    .from('patient_credit_item_balances_v')
    .select('*')
    .eq('patient_id', patientId)
    .order('package_title')
    .order('service_name_snapshot');

  if (serviceIds?.length) query = query.in('service_id', serviceIds);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(normalizeEntitlement);
}

export function usePatientEntitlements(patientId?: string | null, serviceIds?: string[]) {
  const [data, setData] = useState<PatientEntitlement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const serviceKey = useMemo(() => [...(serviceIds ?? [])].sort().join(','), [serviceIds]);

  const refresh = useCallback(async () => {
    if (!patientId) {
      setData([]);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const rows = await fetchPatientEntitlements(patientId, serviceKey ? serviceKey.split(',') : undefined);
      setData(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Falha ao carregar créditos.'));
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [patientId, serviceKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}

export function usePatientPackages(patientId?: string | null) {
  const [packages, setPackages] = useState<PatientPackageSummary[]>([]);
  const [ledger, setLedger] = useState<PackageLedgerMovement[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!patientId) {
      setPackages([]);
      setLedger([]);
      return;
    }
    setLoading(true);
    try {
      const [{ data: packageRows, error: packageError }, { data: ledgerRows, error: ledgerError }] = await Promise.all([
        supabase.from('patient_package_summary_v').select('*').eq('patient_id', patientId).order('activated_at', { ascending: false, nullsFirst: false }),
        supabase.from('patient_credit_ledger').select('id,patient_id,package_id,package_item_id,movement_type,quantity_delta,source_type,source_id,procedure_id_snapshot,procedure_item_id_snapshot,reason,created_by,created_at').eq('patient_id', patientId).order('created_at', { ascending: false }).limit(100),
      ]);
      if (packageError) throw packageError;
      if (ledgerError) throw ledgerError;
      setPackages((packageRows ?? []).map(normalizeSummary));
      setLedger((ledgerRows ?? []).map((row: any) => ({ ...row, quantity_delta: Number(row.quantity_delta) })) as PackageLedgerMovement[]);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { packages, ledger, loading, refresh };
}

export function usePackagesActions() {
  const [loading, setLoading] = useState(false);

  const call = useCallback(async <T,>(rpc: string, params: Record<string, unknown>) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc(rpc, params as never);
      if (error) throw error;
      return data as T;
    } finally {
      setLoading(false);
    }
  }, []);

  const createManual = useCallback((input: {
    patientId: string;
    title: string;
    sourceType: 'manual' | 'complimentary';
    items: Array<{ service_id: string; quantity: number; commercial_value?: number | null }>;
    validFrom?: string | null;
    validUntil?: string | null;
    reason: string;
    notes?: string | null;
    idempotencyKey?: string;
  }) => call<any>('create_manual_package_v1', {
    p_idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
    p_patient_id: input.patientId,
    p_title: input.title,
    p_source_type: input.sourceType,
    p_items: input.items,
    p_valid_from: input.validFrom ?? null,
    p_valid_until: input.validUntil ?? null,
    p_reason: input.reason,
    p_notes: input.notes ?? null,
  }), [call]);

  const createFromProposal = useCallback((proposalVersionId: string, options?: { validFrom?: string | null; validUntil?: string | null; notes?: string | null; idempotencyKey?: string }) =>
    call<any>('create_package_from_proposal_v1', {
      p_proposal_version_id: proposalVersionId,
      p_idempotency_key: options?.idempotencyKey ?? crypto.randomUUID(),
      p_valid_from: options?.validFrom ?? null,
      p_valid_until: options?.validUntil ?? null,
      p_notes: options?.notes ?? null,
    }), [call]);

  const activate = useCallback((packageId: string) => call<any>('activate_package_v1', {
    p_package_id: packageId,
    p_idempotency_key: crypto.randomUUID(),
  }), [call]);

  const adjust = useCallback((packageItemId: string, quantityDelta: number, reason: string) => call<any>('adjust_package_credit_v1', {
    p_package_item_id: packageItemId,
    p_quantity_delta: quantityDelta,
    p_reason: reason,
    p_idempotency_key: crypto.randomUUID(),
  }), [call]);

  const voidPackage = useCallback((packageId: string, reason: string) => call<any>('void_package_v1', {
    p_package_id: packageId,
    p_reason: reason,
  }), [call]);

  const issueVoucher = useCallback((input: {
    serviceId: string;
    quantity: number;
    validUntil?: string | null;
    recipientName?: string | null;
    recipientPhone?: string | null;
    patientId?: string | null;
    source?: string | null;
    note?: string | null;
  }) => call<VoucherRecord>('issue_voucher_v1', {
    p_service_id: input.serviceId,
    p_quantity: input.quantity,
    p_valid_until: input.validUntil ?? null,
    p_recipient_name: input.recipientName ?? null,
    p_recipient_phone: input.recipientPhone ?? null,
    p_patient_id: input.patientId ?? null,
    p_source: input.source ?? null,
    p_note: input.note ?? null,
  }), [call]);

  const redeemVoucher = useCallback((code: string, patientId: string) => call<any>('redeem_voucher_v1', {
    p_code: code,
    p_patient_id: patientId,
  }), [call]);

  const voidVoucher = useCallback((voucherId: string, reason: string) => call<VoucherRecord>('void_voucher_v1', {
    p_voucher_id: voucherId,
    p_reason: reason,
  }), [call]);

  const recordSale = useCallback((packageId: string, entries: PackagePaymentEntry[], idempotencyKey?: string) => call<any>('record_package_sale_v1', {
    p_package_id: packageId,
    p_idempotency_key: idempotencyKey ?? crypto.randomUUID(),
    p_payment_entries: entries,
  }), [call]);

  return { loading, createManual, createFromProposal, activate, adjust, voidPackage, issueVoucher, redeemVoucher, voidVoucher, recordSale };
}
