import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface PatientProfitabilitySummary {
  attendances: number;
  returns: number;
  package_sales: number;
  total_rows: number;
  sales: number;
  received: number;
  pending: number;
  barter: number;
  fees: number;
  costs: number;
  materials_and_procedures_cost: number;
  clinical_time_cost: number;
  clinical_minutes: number;
  contribution: number | null;
  margin_pct: number | null;
  cash_result: number | null;
  complete: boolean;
  incomplete_rows: number;
}

export interface PatientProfitabilityRow {
  id: string;
  event_at: string;
  kind: 'attendance' | 'package';
  title: string;
  is_return: boolean;
  parent_procedure_id: string | null;
  sales: number;
  received: number;
  pending: number;
  barter: number;
  fees: number;
  costs: number;
  clinical_time_cost: number;
  clinical_minutes: number;
  contribution: number | null;
  complete: boolean;
}

type Report = {
  summary: PatientProfitabilitySummary;
  rows: PatientProfitabilityRow[];
};

const PAGE_SIZE = 20;

export function usePatientProfitability(patientId: string, from: string | null, to: string | null) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = useCallback(async (offset: number): Promise<Report> => {
    const { data, error: rpcError } = await supabase.rpc('get_patient_profitability_v1', {
      p_patient_id: patientId,
      p_date_from: from,
      p_date_to: to,
      p_limit: PAGE_SIZE,
      p_offset: offset,
    });
    if (rpcError) throw rpcError;
    if (!data || typeof data !== 'object' || !('summary' in data) || !('rows' in data)) {
      throw new Error('Resposta financeira inválida.');
    }
    return data as Report;
  }, [patientId, from, to]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setReport(null);
    setError(null);
    try {
      setReport(await fetchReport(0));
    } catch (err) {
      console.error('[patient-profitability]', err);
      setError('Não foi possível carregar a rentabilidade. Verifique se a migração do banco foi aplicada.');
    } finally {
      setLoading(false);
    }
  }, [fetchReport]);

  useEffect(() => { void refresh(); }, [refresh]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !report || report.rows.length >= report.summary.total_rows) return;
    setLoadingMore(true);
    try {
      const next = await fetchReport(report.rows.length);
      setReport(current => current ? {
        ...current,
        rows: [...current.rows, ...next.rows.filter(item => !current.rows.some(existing => existing.id === item.id && existing.kind === item.kind))],
      } : next);
      setError(null);
    } catch (err) {
      console.error('[patient-profitability:page]', err);
      setError('Não foi possível carregar mais atendimentos.');
    } finally {
      setLoadingMore(false);
    }
  }, [fetchReport, loading, loadingMore, report]);

  return { report, loading, loadingMore, error, refresh, loadMore };
}
