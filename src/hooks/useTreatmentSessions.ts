import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export type TreatmentSessionRecord = {
  redemption_id: string;
  patient_id: string;
  package_id: string;
  package_title: string;
  package_item_id: string;
  service_id: string | null;
  service_name_snapshot: string;
  source_combo_service_id: string | null;
  source_combo_name_snapshot: string | null;
  procedure_id_snapshot: string;
  procedure_item_id_snapshot: string;
  quantity: number;
  session_start: number;
  session_end: number;
  session_total: number;
  created_at: string;
};

export async function fetchTreatmentSessions(patientId: string) {
  const { data, error } = await supabase
    .from('procedure_treatment_sessions_v1')
    .select('*')
    .eq('patient_id', patientId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(row => ({
    ...row,
    quantity: Number(row.quantity),
    session_start: Number(row.session_start),
    session_end: Number(row.session_end),
    session_total: Number(row.session_total),
  })) as TreatmentSessionRecord[];
}

export function useTreatmentSessions(patientId?: string | null) {
  const [sessions, setSessions] = useState<TreatmentSessionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    if (!patientId) {
      setSessions([]);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      setSessions(await fetchTreatmentSessions(patientId));
      setError(null);
    } catch (err) {
      setSessions([]);
      setError(err instanceof Error ? err : new Error('Falha ao carregar sessões do tratamento.'));
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => { void refresh(); }, [refresh]);
  return { sessions, loading, error, refresh };
}
