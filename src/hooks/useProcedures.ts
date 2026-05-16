import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Procedure, PaymentMethod } from '../types';
import { addMonths, format } from 'date-fns';

interface CreateProcedureInput {
  patient_id: string;
  appointment_id?: string | null;
  performed_at?: string;
  services_ids: string[];
  total_value: number;
  total_cost: number;
  payment_method: PaymentMethod;
  card_fee_pct?: number | null;
  card_fee_value?: number | null;
  net_value: number;
  notes?: string | null;
  pix_installments_count?: number;
}

export function useProcedures(patientId?: string) {
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('procedures')
      .select('*')
      .order('performed_at', { ascending: false });
    if (patientId) q = q.eq('patient_id', patientId);
    const { data } = await q;
    setProcedures(data ?? []);
    setLoading(false);
  }, [patientId]);

  useEffect(() => { refresh(); }, [refresh]);

  const create = async (input: CreateProcedureInput): Promise<Procedure> => {
    const { data: { user } } = await supabase.auth.getUser();
    const uid = user!.id;

    const { data: proc, error } = await supabase
      .from('procedures')
      .insert({
        user_id: uid,
        patient_id: input.patient_id,
        appointment_id: input.appointment_id ?? null,
        performed_at: input.performed_at ?? new Date().toISOString(),
        services_ids: input.services_ids,
        total_value: input.total_value,
        total_cost: input.total_cost,
        payment_method: input.payment_method,
        card_fee_pct: input.card_fee_pct ?? null,
        card_fee_value: input.card_fee_value ?? null,
        net_value: input.net_value,
        notes: input.notes ?? null,
      })
      .select()
      .single();

    if (error) throw error;

    if (input.payment_method === 'pix_parcelado' && input.pix_installments_count && input.pix_installments_count >= 2) {
      const n = input.pix_installments_count;
      const base = Math.round((input.total_value / n) * 100) / 100;
      const today = new Date();

      const rows = Array.from({ length: n }, (_, i) => {
        const num = i + 1;
        const dueDate = addMonths(today, num);
        return {
          user_id: uid,
          procedure_id: proc.id,
          installment_num: num,
          total_installments: n,
          amount: num === n ? input.total_value - base * (n - 1) : base,
          due_date: format(dueDate, 'yyyy-MM-dd'),
          paid_at: null,
          reminded_at: null,
        };
      });

      const { error: pixErr } = await supabase.from('pix_installments').insert(rows);
      if (pixErr) throw pixErr;
    }

    await refresh();
    return proc as Procedure;
  };

  return { procedures, loading, create, refresh };
}
