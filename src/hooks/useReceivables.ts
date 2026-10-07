import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { CardBrand, SimplePaymentMethod } from '../types';

export interface OpenReceivable {
  procedure_id: string;
  patient_id: string;
  patient_name: string;
  performed_at: string;
  total_value: number;
  received_amount: number;
  pending_amount: number;
  service_names: string;
  next_due_date: string | null;
  pending_entries: number;
  last_payment_at: string | null;
}

export interface RegisterReceiptInput {
  procedureId: string;
  amount: number;
  method: SimplePaymentMethod;
  paidOn: string;
  cardBrand?: CardBrand | null;
  installments?: number;
  absorveTaxa?: boolean;
  feePct?: number;
}

function normalize(row: Record<string, unknown>): OpenReceivable {
  return {
    procedure_id: String(row.procedure_id),
    patient_id: String(row.patient_id),
    patient_name: String(row.patient_name ?? 'Paciente'),
    performed_at: String(row.performed_at),
    total_value: Number(row.total_value ?? 0),
    received_amount: Number(row.received_amount ?? 0),
    pending_amount: Number(row.pending_amount ?? 0),
    service_names: String(row.service_names ?? 'Atendimento'),
    next_due_date: row.next_due_date ? String(row.next_due_date) : null,
    pending_entries: Number(row.pending_entries ?? 0),
    last_payment_at: row.last_payment_at ? String(row.last_payment_at) : null,
  };
}

export function useReceivables(patientId?: string) {
  const [items, setItems] = useState<OpenReceivable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase.rpc('list_open_receivables_v1', {
        p_patient_id: patientId ?? null,
      });
      if (queryError) throw queryError;
      setItems(((data ?? []) as Record<string, unknown>[]).map(normalize));
    } catch (err) {
      console.error('[receivables:list]', err);
      setItems([]);
      setError('Não foi possível carregar os valores em aberto.');
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const registerReceipt = async (input: RegisterReceiptInput) => {
    const { error: receiptError } = await supabase.rpc('register_procedure_receipt_v1', {
      p_procedure_id: input.procedureId,
      p_amount: input.amount,
      p_method: input.method,
      p_paid_on: input.paidOn,
      p_card_brand: input.cardBrand ?? null,
      p_installments: input.installments ?? 1,
      p_absorve_taxa: input.absorveTaxa ?? true,
      p_fee_pct: input.feePct ?? 0,
    });
    if (receiptError) throw receiptError;
    await refresh();
  };

  return { items, loading, error, refresh, registerReceipt };
}
