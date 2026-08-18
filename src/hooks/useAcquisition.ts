import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { AcquisitionSource } from '../lib/acquisition';

type SourceRow = {
  source: AcquisitionSource | null;
  label: string;
  registrations: number;
  attended_patients: number;
  procedures: number;
  production_value: number;
};

type ReferrerRow = {
  patient_id: string;
  name: string;
  referred_registered: number;
  referred_with_attendance: number;
};

export type AcquisitionSummary = {
  period: { start_date: string; end_date_exclusive: string; timezone: string };
  sources: SourceRow[];
  top_referrers: ReferrerRow[];
};

export function useAcquisition(startDate: string, endDateExclusive: string) {
  const [data, setData] = useState<AcquisitionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data: result, error: rpcError } = await supabase.rpc('get_acquisition_summary_v1', { p_start_date: startDate, p_end_date_exclusive: endDateExclusive });
      if (rpcError) throw rpcError;
      setData(result as AcquisitionSummary);
    } catch (err) {
      console.error('[acquisition:summary]', err);
      setError('Não foi possível carregar a visão de aquisição.');
      setData(null);
    } finally { setLoading(false); }
  }, [endDateExclusive, startDate]);

  useEffect(() => { void load(); }, [load]);
  return { data, loading, error, refresh: load };
}
