import { supabase } from '../lib/supabase';
import type { InjectablePoint, Procedure } from '../types';

export interface CreateAtomicAttendanceInput {
  idempotency_key: string;
  patient_id: string;
  appointment_id: string | null;
  performed_at: string;
  items: Array<{ service_id: string; qty: number; final_price: number }>;
  payment_entries: Array<{
    method: string;
    base_amount: number;
    amount: number;
    card_brand: string | null;
    installments: number;
    fee_pct: number | null;
    fee_value: number | null;
    net_amount: number;
    absorve_taxa: boolean;
    scheduled_date: string | null;
  }>;
  injectable_maps: Array<{ points: InjectablePoint[] }>;
  notes: string | null;
}

export function useAtomicAttendance() {
  const createAtomic = async (input: CreateAtomicAttendanceInput): Promise<Procedure> => {
    const { data, error } = await supabase.rpc('create_procedure_v2', {
      p_idempotency_key: input.idempotency_key,
      p_patient_id: input.patient_id,
      p_appointment_id: input.appointment_id,
      p_performed_at: input.performed_at,
      p_items: input.items,
      p_payment_entries: input.payment_entries,
      p_injectable_maps: input.injectable_maps,
      p_notes: input.notes,
    });

    if (error) throw error;
    if (!data) throw new Error('ATTENDANCE_EMPTY_RESPONSE');
    return data as Procedure;
  };

  return { createAtomic };
}
