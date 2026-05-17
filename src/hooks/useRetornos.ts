import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { differenceInDays, addDays, parseISO, startOfDay } from 'date-fns';
import type { Service } from '../types';

export interface RetornoInfo {
  patientId: string;
  patientName: string;
  lastProcedureAt: Date;
  serviceNames: string[];
  windowStart: Date | null;
  windowEnd: Date | null;
  status: 'overdue' | 'in_window' | 'upcoming' | 'ok' | 'no_window';
  daysLabel: string;
}

const STATUS_ORDER: Record<RetornoInfo['status'], number> = {
  overdue: 0,
  in_window: 1,
  upcoming: 2,
  ok: 3,
  no_window: 4,
};

function calcStatus(windowStart: Date | null, windowEnd: Date | null): RetornoInfo['status'] {
  if (!windowStart || !windowEnd) return 'no_window';
  const today = startOfDay(new Date());
  const start = startOfDay(windowStart);
  const end = startOfDay(windowEnd);
  if (today > end) return 'overdue';
  if (today >= start) return 'in_window';
  const daysUntil = differenceInDays(start, today);
  return daysUntil <= 5 ? 'upcoming' : 'ok';
}

function buildDaysLabel(
  status: RetornoInfo['status'],
  windowStart: Date | null,
  windowEnd: Date | null,
  lastProcedureAt: Date,
): string {
  const today = startOfDay(new Date());
  switch (status) {
    case 'overdue': {
      const d = differenceInDays(today, startOfDay(windowEnd!));
      return `${d} dia${d !== 1 ? 's' : ''} atrasada`;
    }
    case 'in_window': {
      const d = differenceInDays(today, startOfDay(lastProcedureAt));
      return `há ${d} dia${d !== 1 ? 's' : ''} — janela aberta`;
    }
    case 'upcoming':
    case 'ok': {
      const d = differenceInDays(startOfDay(windowStart!), today);
      return `em ${d} dia${d !== 1 ? 's' : ''}`;
    }
    default:
      return '';
  }
}

type ProcRow = {
  id: string;
  patient_id: string;
  performed_at: string;
  services_ids: string[];
  patient: { id: string; name: string } | null;
};

export function useRetornos(servicos: Service[]) {
  const [retornos, setRetornos] = useState<RetornoInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (servicos.length === 0) {
      setLoading(false);
      return;
    }

    try {
      const { data, error: fetchError } = await supabase
        .from('procedures')
        .select('id, patient_id, performed_at, services_ids, patient:patients(id, name)')
        .order('performed_at', { ascending: false });

      if (fetchError) throw fetchError;

      const rows = (data ?? []) as unknown as ProcRow[];

      // Group by patient_id — rows are desc so first occurrence = most recent
      const byPatient = new Map<string, ProcRow>();
      for (const row of rows) {
        if (!byPatient.has(row.patient_id)) {
          byPatient.set(row.patient_id, row);
        }
      }

      const result: RetornoInfo[] = [];

      for (const [, row] of byPatient) {
        const procServices = (row.services_ids ?? [])
          .map(id => servicos.find(s => s.id === id))
          .filter((s): s is Service => s !== undefined);

        const minValues = procServices
          .map(s => s.return_min_days)
          .filter((d): d is number => d !== null);
        const maxValues = procServices
          .map(s => s.return_max_days)
          .filter((d): d is number => d !== null);

        const lastDate = parseISO(row.performed_at);
        const windowStart = minValues.length > 0 ? addDays(lastDate, Math.min(...minValues)) : null;
        const windowEnd = maxValues.length > 0 ? addDays(lastDate, Math.max(...maxValues)) : null;

        const status = calcStatus(windowStart, windowEnd);
        const daysLabel = buildDaysLabel(status, windowStart, windowEnd, lastDate);

        result.push({
          patientId: row.patient_id,
          patientName: row.patient?.name ?? 'Paciente',
          lastProcedureAt: lastDate,
          serviceNames: procServices.map(s => s.name),
          windowStart,
          windowEnd,
          status,
          daysLabel,
        });
      }

      result.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
      setRetornos(result);
    } catch (err) {
      setRetornos([]);
      setError(err instanceof Error ? err.message : 'Erro ao calcular retornos.');
    } finally {
      setLoading(false);
    }
  }, [servicos]);

  useEffect(() => { refresh(); }, [refresh]);

  return { retornos, loading, error, refresh };
}
