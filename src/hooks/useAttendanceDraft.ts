import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase';
import { clearClinicalMinutes, getClinicalMinutes, setClinicalMinutes } from '../lib/clinicalTimeRuntime';

export type AttendanceDraftPayload = {
  performedDate?: string;
  notes?: string;
  serviceIds?: string[];
  coverageByService?: Record<string, string | undefined>;
  finalPriceByService?: Record<string, number>;
  courtesyByService?: Record<string, boolean>;
  materials?: unknown[];
  clinicalMinutes?: number;
  paymentTiming?: 'today' | 'past' | 'later';
  payments?: unknown[];
};

type AttendanceDraftRow = {
  id: string;
  patient_id: string;
  appointment_id: string | null;
  payload: AttendanceDraftPayload;
  updated_at: string;
};

export function useAttendanceDraft(patientId?: string) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (): Promise<AttendanceDraftRow | null> => {
    if (!patientId) return null;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('attendance_drafts')
        .select('id, patient_id, appointment_id, payload, updated_at')
        .eq('patient_id', patientId)
        .maybeSingle();
      if (error) throw error;
      const row = (data as AttendanceDraftRow | null) ?? null;
      if (row) setClinicalMinutes(Number(row.payload?.clinicalMinutes ?? 0));
      else clearClinicalMinutes();
      return row;
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  const save = useCallback(async (payload: AttendanceDraftPayload, appointmentId?: string | null) => {
    if (!patientId) throw new Error('Selecione a paciente antes de salvar o rascunho.');
    setSaving(true);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error('Sessão expirada. Entre novamente.');

      const enrichedPayload: AttendanceDraftPayload = {
        ...payload,
        clinicalMinutes: getClinicalMinutes(),
      };

      const { error } = await supabase
        .from('attendance_drafts')
        .upsert({
          user_id: user.id,
          patient_id: patientId,
          appointment_id: appointmentId ?? null,
          payload: enrichedPayload,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,patient_id' });
      if (error) throw error;
    } finally {
      setSaving(false);
    }
  }, [patientId]);

  const remove = useCallback(async () => {
    if (!patientId) return;
    const { error } = await supabase
      .from('attendance_drafts')
      .delete()
      .eq('patient_id', patientId);
    if (error) throw error;
    clearClinicalMinutes();
  }, [patientId]);

  return { load, save, remove, loading, saving };
}
