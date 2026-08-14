import { useQuery } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { supabase } from '../lib/supabase';
import {
  DASHBOARD_EXPIRY_DAYS,
  clinicTodayIso,
  type DashboardAttention,
  type DashboardOverview,
  type DashboardPeriod,
  type DashboardSeriesPoint,
} from '../lib/dashboardMetrics';

function rpcError(message: string, error: { message?: string } | null) {
  return new Error(error?.message || message);
}

export function useDashboard(period: DashboardPeriod) {
  const { user } = useAuth();
  const userId = user?.id ?? 'anonymous';
  const today = clinicTodayIso();

  const attentionQuery = useQuery({
    queryKey: ['dashboard-attention-v1', userId, today],
    enabled: Boolean(user),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<DashboardAttention> => {
      const { data, error } = await supabase.rpc('get_dashboard_attention_v1', {
        p_today: today,
        p_expiry_days: DASHBOARD_EXPIRY_DAYS,
      });
      if (error || !data) throw rpcError('Não foi possível carregar as prioridades de hoje.', error);
      return data as DashboardAttention;
    },
  });

  const overviewQuery = useQuery({
    queryKey: [
      'dashboard-overview-v1',
      userId,
      period.startDate,
      period.endDateExclusive,
      period.previousStartDate,
      period.previousEndDateExclusive,
    ],
    enabled: Boolean(user),
    staleTime: 120_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<DashboardOverview> => {
      const { data, error } = await supabase.rpc('get_dashboard_overview_v1', {
        p_start_date: period.startDate,
        p_end_date_exclusive: period.endDateExclusive,
        p_previous_start_date: period.previousStartDate,
        p_previous_end_date_exclusive: period.previousEndDateExclusive,
      });
      if (error || !data) throw rpcError('Não foi possível carregar o desempenho do período.', error);
      return data as DashboardOverview;
    },
  });

  const seriesQuery = useQuery({
    queryKey: ['dashboard-series-v1', userId, period.startDate, period.endDateExclusive, period.granularity],
    enabled: Boolean(user),
    staleTime: 120_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<DashboardSeriesPoint[]> => {
      const { data, error } = await supabase.rpc('get_dashboard_series_v1', {
        p_start_date: period.startDate,
        p_end_date_exclusive: period.endDateExclusive,
        p_granularity: period.granularity,
      });
      if (error || !data) throw rpcError('Não foi possível carregar a série financeira.', error);
      return data as DashboardSeriesPoint[];
    },
  });

  const refresh = async () => {
    await Promise.all([
      attentionQuery.refetch(),
      overviewQuery.refetch(),
      seriesQuery.refetch(),
    ]);
  };

  return {
    attention: attentionQuery.data ?? null,
    overview: overviewQuery.data ?? null,
    series: seriesQuery.data ?? [],
    isLoading: attentionQuery.isLoading || overviewQuery.isLoading || seriesQuery.isLoading,
    isRefreshing: attentionQuery.isFetching || overviewQuery.isFetching || seriesQuery.isFetching,
    error: attentionQuery.error ?? overviewQuery.error ?? seriesQuery.error ?? null,
    refresh,
  };
}
