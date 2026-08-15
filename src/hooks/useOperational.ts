import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { supabase } from '../lib/supabase';
import { emptyAttentionCounts, emptyQualitySummary, type DataQualityIssue, type DataQualitySummary, type OperationalAttentionCounts, type OperationalAttentionItem, type OperationalDaySummary, type OperationalWeekSummary, type PatientNextAction, type PossibleDuplicatePair } from '../lib/operational';

function errorMessage(error: { message?: string } | null, fallback: string) {
  return new Error(error?.message || fallback);
}

export function useOperationalHome(today: string) {
  const { user } = useAuth();
  const userId = user?.id ?? 'anonymous';
  const base = { enabled: Boolean(user), refetchOnWindowFocus: true } as const;
  const attention = useQuery({ ...base, queryKey: ['operational-attention-v1', userId], staleTime: 60_000, queryFn: async () => { const { data, error } = await supabase.rpc('list_operational_attention_v1', { p_category: null, p_limit: 8, p_offset: 0 }); if (error) throw errorMessage(error, 'Não foi possível carregar a atenção operacional.'); return (data ?? []) as OperationalAttentionItem[]; } });
  const counts = useQuery({ ...base, queryKey: ['operational-attention-counts-v1', userId], staleTime: 60_000, queryFn: async () => { const { data, error } = await supabase.rpc('get_operational_attention_counts_v1'); if (error) throw errorMessage(error, 'Não foi possível carregar os contadores operacionais.'); return (data ?? emptyAttentionCounts) as OperationalAttentionCounts; } });
  const day = useQuery({ ...base, queryKey: ['operational-day-v1', userId, today], staleTime: 60_000, queryFn: async () => { const { data, error } = await supabase.rpc('get_operational_day_summary_v1', { p_day: today }); if (error) throw errorMessage(error, 'Não foi possível carregar o resumo de hoje.'); return data as OperationalDaySummary; } });
  const week = useQuery({ ...base, queryKey: ['operational-week-v1', userId, today], staleTime: 120_000, queryFn: async () => { const { data, error } = await supabase.rpc('get_operational_week_summary_v1', { p_start: today }); if (error) throw errorMessage(error, 'Não foi possível carregar a visão da semana.'); return data as OperationalWeekSummary; } });
  const refresh = async () => Promise.all([attention.refetch(), counts.refetch(), day.refetch(), week.refetch()]);
  return { items: attention.data ?? [], counts: counts.data ?? emptyAttentionCounts, day: day.data ?? null, week: week.data ?? null, loading: attention.isLoading || counts.isLoading || day.isLoading || week.isLoading, refreshing: attention.isFetching || counts.isFetching || day.isFetching || week.isFetching, error: attention.error ?? counts.error ?? day.error ?? week.error ?? null, refresh };
}

export function usePatientNextAction(patientId: string | undefined, appointmentId?: string | null) {
  const { user } = useAuth();
  return useQuery({ queryKey: ['patient-next-action-v1', user?.id ?? 'anonymous', patientId, appointmentId ?? null], enabled: Boolean(user && patientId), staleTime: 60_000, refetchOnWindowFocus: true, queryFn: async (): Promise<PatientNextAction | null> => { const { data, error } = await supabase.rpc('get_patient_next_action_v1', { p_patient_id: patientId, p_appointment_id: appointmentId ?? null }); if (error) throw errorMessage(error, 'Não foi possível determinar a próxima ação.'); return (data ?? null) as PatientNextAction | null; } });
}

export function useDataQualitySummary() {
  const { user } = useAuth();
  return useQuery({ queryKey: ['data-quality-summary-v1', user?.id ?? 'anonymous'], enabled: Boolean(user), staleTime: 15 * 60_000, refetchOnWindowFocus: false, retry: 1, queryFn: async (): Promise<DataQualitySummary> => { const { data, error } = await supabase.rpc('get_data_quality_summary_v1'); if (error) throw errorMessage(error, 'Não foi possível verificar a qualidade dos dados.'); return (data ?? emptyQualitySummary) as DataQualitySummary; } });
}

export function useDataQualityIssues(filters: { severity?: string | null; category?: string | null; search?: string }) {
  const { user } = useAuth();
  return useQuery({ queryKey: ['data-quality-issues-v1', user?.id ?? 'anonymous', filters.severity ?? null, filters.category ?? null, filters.search ?? ''], enabled: Boolean(user), staleTime: 60_000, refetchOnWindowFocus: false, queryFn: async (): Promise<DataQualityIssue[]> => { const { data, error } = await supabase.rpc('list_data_quality_issues_v1', { p_severity: filters.severity ?? null, p_category: filters.category ?? null, p_search: filters.search?.trim() || null, p_limit: 100, p_offset: 0 }); if (error) throw errorMessage(error, 'Não foi possível carregar os itens de qualidade.'); return (data ?? []) as DataQualityIssue[]; } });
}

export function usePossibleDuplicatePair(issueKey: string | null) {
  const { user } = useAuth();
  return useQuery({ queryKey: ['possible-duplicate-pair-v1', user?.id ?? 'anonymous', issueKey], enabled: Boolean(user && issueKey), staleTime: 60_000, queryFn: async (): Promise<PossibleDuplicatePair | null> => { const { data, error } = await supabase.rpc('get_possible_duplicate_pair_v1', { p_issue_key: issueKey }); if (error) throw errorMessage(error, 'Não foi possível comparar os cadastros.'); const rows = (data ?? []) as PossibleDuplicatePair[]; return rows[0] ?? null; } });
}

export function useDismissDataQualityIssue() {
  const queryClient = useQueryClient();
  return async (issueKey: string) => {
    const { error } = await supabase.rpc('dismiss_data_quality_issue_v1', { p_issue_key: issueKey, p_reason: 'not_duplicate' });
    if (error) throw errorMessage(error, 'Não foi possível registrar a revisão.');
    await Promise.all([queryClient.invalidateQueries({ queryKey: ['data-quality-summary-v1'] }), queryClient.invalidateQueries({ queryKey: ['data-quality-issues-v1'] }), queryClient.invalidateQueries({ queryKey: ['possible-duplicate-pair-v1'] })]);
  };
}
