import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getTimelineCursor, mergeTimelineEvents, type PatientTimelineEvent } from '../lib/patient360';

export interface Patient360Overview {
  nextAppointment: null | {
    id: string;
    scheduledAt: string;
    status: string;
    serviceId: string | null;
    serviceName: string;
  };
  lastProcedure: null | {
    id: string;
    performedAt: string;
    itemNames: string[];
    totalValue: number;
    paidAmount: number;
    pendingAmount: number;
  };
  activeReturnsCount: number;
  priorityReturn: null | {
    id: string;
    serviceName: string;
    returnType: string;
    windowStart: string;
    windowEnd: string;
    contactedAt: string | null;
    appointmentId: string | null;
    appointmentStatus: string | null;
    appointmentScheduledAt: string | null;
    status: 'overdue' | 'in_window' | 'upcoming';
  };
  financialSummary: {
    total: number;
    received: number;
    pending: number;
    lastPaymentAt: string | null;
  };
  openNotesCount: number;
  overdueNotesCount: number;
  anamnesis: {
    completed: boolean;
    allergies: string | null;
    medications: string | null;
    updatedAt: string | null;
    versionNumber: number | null;
    draftInProgress: boolean;
    draftSavedAt: string | null;
  };
}

type OverviewRow = {
  next_appointment: Record<string, unknown> | null;
  last_procedure: Record<string, unknown> | null;
  active_returns_count: number | string;
  priority_return: Record<string, unknown> | null;
  financial_summary: Record<string, unknown> | null;
  open_notes_count: number | string;
  overdue_notes_count: number | string;
  anamnesis_summary: Record<string, unknown> | null;
};

type TimelineRow = {
  event_key: string;
  event_type: string;
  occurred_at: string;
  title: string;
  subtitle: string | null;
  source_id: string;
  metadata: Record<string, unknown> | null;
};

const number = (value: unknown) => Number(value ?? 0);
const string = (value: unknown) => typeof value === 'string' ? value : '';
const nullableString = (value: unknown) => typeof value === 'string' && value ? value : null;
const nullableNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

function mapOverview(row: OverviewRow): Patient360Overview {
  const next = row.next_appointment;
  const last = row.last_procedure;
  const priority = row.priority_return;
  const finance = row.financial_summary ?? {};
  const anamnesis = row.anamnesis_summary ?? {};

  return {
    nextAppointment: next ? {
      id: string(next.id),
      scheduledAt: string(next.scheduled_at),
      status: string(next.status),
      serviceId: nullableString(next.service_id),
      serviceName: string(next.service_name) || 'Consulta',
    } : null,
    lastProcedure: last ? {
      id: string(last.id),
      performedAt: string(last.performed_at),
      itemNames: Array.isArray(last.item_names) ? last.item_names.filter((item): item is string => typeof item === 'string') : [],
      totalValue: number(last.total_value),
      paidAmount: number(last.paid_amount),
      pendingAmount: number(last.pending_amount),
    } : null,
    activeReturnsCount: number(row.active_returns_count),
    priorityReturn: priority ? {
      id: string(priority.id),
      serviceName: string(priority.service_name),
      returnType: string(priority.return_type),
      windowStart: string(priority.window_start),
      windowEnd: string(priority.window_end),
      contactedAt: nullableString(priority.contacted_at),
      appointmentId: nullableString(priority.appointment_id),
      appointmentStatus: nullableString(priority.appointment_status),
      appointmentScheduledAt: nullableString(priority.appointment_scheduled_at),
      status: (string(priority.status) || 'upcoming') as Patient360Overview['priorityReturn'] extends infer T ? T extends { status: infer S } ? S : never : never,
    } : null,
    financialSummary: {
      total: number(finance.total),
      received: number(finance.received),
      pending: number(finance.pending),
      lastPaymentAt: nullableString(finance.last_payment_at),
    },
    openNotesCount: number(row.open_notes_count),
    overdueNotesCount: number(row.overdue_notes_count),
    anamnesis: {
      completed: Boolean(anamnesis.completed),
      allergies: nullableString(anamnesis.allergies),
      medications: nullableString(anamnesis.medications),
      updatedAt: nullableString(anamnesis.updated_at),
      versionNumber: nullableNumber(anamnesis.version_number),
      draftInProgress: Boolean(anamnesis.draft_in_progress),
      draftSavedAt: nullableString(anamnesis.draft_saved_at),
    },
  };
}

function friendlyPatientError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String((error as { message?: string } | null)?.message ?? '');
  if (/SESSION_REQUIRED|JWT|session/i.test(message)) return 'Sua sessão expirou. Entre novamente.';
  if (/NOT_FOUND/i.test(message)) return 'Não foi possível carregar esta paciente.';
  return fallback;
}

export function usePatient360Overview(patientId: string) {
  const [overview, setOverview] = useState<Patient360Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_patient_360_overview_v2', { p_patient_id: patientId });
      if (rpcError) throw rpcError;
      const row = (data as OverviewRow[] | null)?.[0];
      setOverview(row ? mapOverview(row) : null);
    } catch (err) {
      console.error('[patient360:overview]', err);
      setOverview(null);
      setError(friendlyPatientError(err, 'Não foi possível carregar a paciente.'));
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => { void refresh(); }, [refresh]);
  return { overview, loading, error, refresh };
}

export function usePatientTimeline(patientId: string, pageSize = 20) {
  const [events, setEvents] = useState<PatientTimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const fetchPage = useCallback(async (append: boolean) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const cursor = append ? getTimelineCursor(events) : null;
      const { data, error: rpcError } = await supabase.rpc('list_patient_timeline_v4', {
        p_patient_id: patientId,
        p_limit: pageSize,
        p_cursor_at: cursor?.at ?? null,
        p_cursor_key: cursor?.key ?? null,
      });
      if (rpcError) throw rpcError;
      const mapped = ((data ?? []) as TimelineRow[]).map<PatientTimelineEvent>(row => ({
        eventKey: row.event_key,
        eventType: row.event_type,
        occurredAt: row.occurred_at,
        title: row.title,
        subtitle: row.subtitle,
        sourceId: row.source_id,
        metadata: row.metadata ?? {},
      }));
      setEvents(current => append ? mergeTimelineEvents(current, mapped) : mapped);
      setHasMore(mapped.length === pageSize);
    } catch (err) {
      console.error('[patient360:timeline]', err);
      if (!append) setEvents([]);
      setError(friendlyPatientError(err, 'Não foi possível carregar o histórico.'));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [events, pageSize, patientId]);

  useEffect(() => {
    setEvents([]);
    setHasMore(false);
    void fetchPage(false);
    // fetchPage intentionally depends on current events for cursor paging; patientId/pageSize reset is enough here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, pageSize]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore) return;
    await fetchPage(true);
  }, [fetchPage, hasMore, loadingMore]);

  const refresh = useCallback(async () => { await fetchPage(false); }, [fetchPage]);
  return { events, loading, loadingMore, error, hasMore, loadMore, refresh };
}
