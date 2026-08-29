import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  normalizePatientJourneyRow,
  type PatientJourneyMoment,
  type PatientJourneyRow,
} from '../lib/patientJourney';

interface UsePatientJourneyOptions {
  search?: string;
  patientId?: string | null;
}

export function usePatientJourney(options: UsePatientJourneyOptions = {}) {
  const search = options.search?.trim() || null;
  const patientId = options.patientId ?? null;
  const [rows, setRows] = useState<PatientJourneyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('list_patient_journey_v1', {
        p_search: search,
        p_moment: null,
        p_attention_only: false,
        p_patient_id: patientId,
      });
      if (rpcError) throw rpcError;
      setRows(((data ?? []) as PatientJourneyRow[]).map(normalizePatientJourneyRow));
    } catch (err) {
      console.error('[patient-journey:load]', err);
      setRows([]);
      setError('Não foi possível carregar a jornada das pacientes.');
    } finally {
      setLoading(false);
    }
  }, [patientId, search]);

  useEffect(() => { void refresh(); }, [refresh]);

  const setMoment = useCallback(async (targetPatientId: string, moment: PatientJourneyMoment | null, note?: string) => {
    const { error: rpcError } = await supabase.rpc('set_patient_journey_moment_v1', {
      p_patient_id: targetPatientId,
      p_moment: moment,
      p_note: note?.trim() || null,
    });
    if (rpcError) throw rpcError;
    await refresh();
  }, [refresh]);

  return { rows, loading, error, refresh, setMoment };
}
