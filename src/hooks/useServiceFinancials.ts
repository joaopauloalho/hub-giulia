import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export type ServiceFinancialSort = 'realized_value' | 'contribution' | 'realizations' | 'contribution_per_hour';

export interface ServiceFinancialPeriod {
  from: string;
  to: string;
}

export interface ServiceFinancialSummary {
  realizations: number;
  unique_patients: number;
  valued_realizations: number;
  cost_known_realizations: number;
  fee_known_realizations: number;
  contribution_known_realizations: number;
  duration_known_realizations: number;
  package_realizations: number;
  unvalued_package_realizations: number;
  table_value: number;
  realized_value: number;
  discount_value: number;
  direct_cost_value: number;
  attributed_fee_value: number;
  contribution_value: number;
  margin_pct: number | null;
  duration_minutes: number;
  contribution_per_hour: number | null;
  valuation_coverage_pct: number;
  cost_coverage_pct: number;
  fee_coverage_pct: number;
  contribution_coverage_pct: number;
  duration_coverage_pct: number;
}

export interface ServiceFinancialRow {
  service_id: string;
  service_name: string;
  is_archived: boolean;
  realizations: number;
  unique_patients: number;
  valued_realizations: number;
  package_realizations: number;
  unvalued_package_realizations: number;
  table_value: number;
  realized_value: number;
  discount_value: number;
  average_ticket: number | null;
  direct_cost_value: number;
  attributed_fee_value: number;
  contribution_value: number;
  margin_pct: number | null;
  duration_minutes: number;
  contribution_per_hour: number | null;
  valuation_coverage_pct: number;
  cost_coverage_pct: number;
  fee_coverage_pct: number;
  contribution_coverage_pct: number;
  duration_coverage_pct: number;
}

export interface ServiceFinancialDetailRow {
  procedure_id: string;
  procedure_item_id: string;
  performed_at: string;
  patient_id: string;
  patient_name: string;
  service_id: string;
  service_name: string;
  qty: number;
  table_value: number;
  realized_value: number;
  discount_value: number | null;
  direct_cost_value: number | null;
  attributed_fee_value: number;
  contribution_value: number | null;
  duration_minutes: number | null;
  via_package: boolean;
  valuation_known: boolean;
  cost_known: boolean;
  fee_known: boolean;
  contribution_known: boolean;
  total_count: number;
}

const EMPTY_SUMMARY: ServiceFinancialSummary = {
  realizations: 0,
  unique_patients: 0,
  valued_realizations: 0,
  cost_known_realizations: 0,
  fee_known_realizations: 0,
  contribution_known_realizations: 0,
  duration_known_realizations: 0,
  package_realizations: 0,
  unvalued_package_realizations: 0,
  table_value: 0,
  realized_value: 0,
  discount_value: 0,
  direct_cost_value: 0,
  attributed_fee_value: 0,
  contribution_value: 0,
  margin_pct: null,
  duration_minutes: 0,
  contribution_per_hour: null,
  valuation_coverage_pct: 100,
  cost_coverage_pct: 100,
  fee_coverage_pct: 100,
  contribution_coverage_pct: 100,
  duration_coverage_pct: 100,
};

function numberOrNull(value: unknown) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSummary(row: Record<string, unknown> | null | undefined): ServiceFinancialSummary {
  if (!row) return EMPTY_SUMMARY;
  const normalized = { ...EMPTY_SUMMARY } as Record<string, number | null>;
  for (const key of Object.keys(EMPTY_SUMMARY)) {
    normalized[key] = numberOrNull(row[key]) ?? (EMPTY_SUMMARY as unknown as Record<string, number | null>)[key];
  }
  return normalized as unknown as ServiceFinancialSummary;
}

function normalizeRow<T extends Record<string, unknown>>(row: T) {
  const out = { ...row } as Record<string, unknown>;
  for (const [key, value] of Object.entries(out)) {
    if (
      key.endsWith('_value') || key.endsWith('_pct') || key.endsWith('_minutes') ||
      key === 'realizations' || key === 'unique_patients' || key === 'valued_realizations' ||
      key === 'package_realizations' || key === 'unvalued_package_realizations' || key === 'average_ticket' ||
      key === 'contribution_per_hour' || key === 'qty' || key === 'total_count'
    ) {
      out[key] = numberOrNull(value);
    }
  }
  return out;
}

export function useServiceFinancials(period: ServiceFinancialPeriod, sortBy: ServiceFinancialSort) {
  const [summary, setSummary] = useState<ServiceFinancialSummary>(EMPTY_SUMMARY);
  const [rows, setRows] = useState<ServiceFinancialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryResult, listResult] = await Promise.all([
        supabase.rpc('get_service_financial_summary_v1', {
          p_date_from: period.from,
          p_date_to: period.to,
        }),
        supabase.rpc('list_service_financial_performance_v1', {
          p_date_from: period.from,
          p_date_to: period.to,
          p_sort_by: sortBy,
          p_service_id: null,
        }),
      ]);
      if (summaryResult.error) throw summaryResult.error;
      if (listResult.error) throw listResult.error;
      const summaryRow = Array.isArray(summaryResult.data) ? summaryResult.data[0] : summaryResult.data;
      setSummary(normalizeSummary(summaryRow as Record<string, unknown> | null));
      setRows(((listResult.data ?? []) as Record<string, unknown>[]).map(row => normalizeRow(row) as unknown as ServiceFinancialRow));
    } catch (err) {
      setSummary(EMPTY_SUMMARY);
      setRows([]);
      setError(err instanceof Error ? err.message : 'Erro ao carregar inteligência financeira por serviço.');
    } finally {
      setLoading(false);
    }
  }, [period.from, period.to, sortBy]);

  useEffect(() => { void refresh(); }, [refresh]);

  const loadDetail = useCallback(async (serviceId: string, page = 0, pageSize = 20) => {
    const { data, error: detailError } = await supabase.rpc('get_service_financial_detail_v1', {
      p_date_from: period.from,
      p_date_to: period.to,
      p_service_id: serviceId,
      p_limit: pageSize,
      p_offset: page * pageSize,
    });
    if (detailError) throw detailError;
    return ((data ?? []) as Record<string, unknown>[]).map(row => normalizeRow(row) as unknown as ServiceFinancialDetailRow);
  }, [period.from, period.to]);

  return { summary, rows, loading, error, refresh, loadDetail };
}
