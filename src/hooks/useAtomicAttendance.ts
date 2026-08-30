import { supabase } from '../lib/supabase';
import type { InjectablePoint, Procedure } from '../types';
import type { PackageCoverageSelection } from '../types/packages';
import type { ProcedureMaterialInput } from '../types/materials';
import { clearClinicalMinutes, getClinicalMinutes } from '../lib/clinicalTimeRuntime';

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
  coverages?: PackageCoverageSelection[];
  materials?: ProcedureMaterialInput[];
  clinical_minutes?: number;
  injectable_maps: Array<{ points: InjectablePoint[] }>;
  injectable_draft_id?: string | null;
  injectable_draft_revision?: number | null;
  notes: string | null;
}

export function useAtomicAttendance() {
  const createAtomic = async (input: CreateAtomicAttendanceInput): Promise<Procedure> => {
    const hasStructuredDraft = Boolean(input.injectable_draft_id && input.injectable_draft_revision);
    const coverages = input.coverages ?? [];
    const materials = input.materials ?? [];
    const clinicalMinutes = Math.max(0, Math.min(1440, Math.round(input.clinical_minutes ?? getClinicalMinutes())));

    if (hasStructuredDraft) {
      const { data, error } = await supabase.rpc('create_procedure_with_injectable_draft_v5', {
        p_idempotency_key: input.idempotency_key,
        p_patient_id: input.patient_id,
        p_appointment_id: input.appointment_id,
        p_performed_at: input.performed_at,
        p_items: input.items,
        p_payment_entries: input.payment_entries,
        p_coverages: coverages,
        p_materials: materials,
        p_clinical_minutes: clinicalMinutes,
        p_notes: input.notes,
        p_draft_id: input.injectable_draft_id,
        p_draft_revision: input.injectable_draft_revision,
      });

      if (error) throw error;
      if (!data) throw new Error('ATTENDANCE_EMPTY_RESPONSE');
      clearClinicalMinutes();
      return data as Procedure;
    }

    const { data, error } = await supabase.rpc('create_procedure_v5', {
      p_idempotency_key: input.idempotency_key,
      p_patient_id: input.patient_id,
      p_appointment_id: input.appointment_id,
      p_performed_at: input.performed_at,
      p_items: input.items,
      p_payment_entries: input.payment_entries,
      p_injectable_maps: input.injectable_maps,
      p_coverages: coverages,
      p_materials: materials,
      p_clinical_minutes: clinicalMinutes,
      p_notes: input.notes,
    });

    if (error) throw error;
    if (!data) throw new Error('ATTENDANCE_EMPTY_RESPONSE');
    clearClinicalMinutes();
    return data as Procedure;
  };

  return { createAtomic };
}
