import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  classifyReturnOperation,
  classifyReturnWindow,
  clinicTodayIso,
  daysBetweenIso,
  returnNeedsAttention,
  returnStatusLabel,
  type ReturnOperationalStatus,
  type ReturnTemporalStatus,
} from '../lib/returnStatus';
import type { Service } from '../types';

export type ReturnType = 'clinical_return' | 'next_session';

export interface RetornoInfo {
  id: string;
  patientId: string | null;
  patientName: string;
  patientPhone: string | null;
  procedureId: string | null;
  procedureItemId: string | null;
  serviceId: string | null;
  serviceName: string;
  returnType: ReturnType;
  procedureDate: string;
  returnStartDays: number;
  returnEndDays: number;
  windowStartIso: string;
  windowEndIso: string;
  contactedAt: string | null;
  contactMethod: string | null;
  appointmentId: string | null;
  appointmentStatus: string | null;
  appointmentScheduledAt: string | null;
  completedAt: string | null;
  dismissedAt: string | null;
  dismissedReason: string | null;
  notes: string | null;
  temporalStatus: ReturnTemporalStatus;
  operationalStatus: ReturnOperationalStatus;
  situationLabel: string;
  needsAttention: boolean;
  lastProcedureAt: Date;
  serviceNames: string[];
  windowStart: Date;
  windowEnd: Date;
  status: 'overdue' | 'in_window' | 'upcoming' | 'ok';
  daysLabel: string;
}

type ReturnRpcRow = {
  id: string;
  patient_id: string | null;
  patient_name: string;
  patient_phone: string | null;
  procedure_id: string | null;
  procedure_item_id: string | null;
  service_id: string | null;
  service_name: string;
  return_type: ReturnType;
  procedure_date: string;
  return_start_days: number;
  return_end_days: number;
  window_start: string;
  window_end: string;
  contacted_at: string | null;
  contact_method: string | null;
  appointment_id: string | null;
  appointment_status: string | null;
  appointment_scheduled_at: string | null;
  completed_at: string | null;
  completed_by_procedure_id: string | null;
  dismissed_at: string | null;
  dismissed_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

function dateAtNoon(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

function legacyStatus(row: ReturnRpcRow, temporal: ReturnTemporalStatus, operational: ReturnOperationalStatus, today: string): RetornoInfo['status'] {
  if (operational === 'scheduled' || operational === 'completed' || operational === 'dismissed') return 'ok';
  if (temporal === 'overdue') return 'overdue';
  if (temporal === 'available' || temporal === 'due_soon') return 'in_window';
  return daysBetweenIso(today, row.window_start) <= 5 ? 'upcoming' : 'ok';
}

function daysLabel(row: ReturnRpcRow, temporal: ReturnTemporalStatus, operational: ReturnOperationalStatus, today: string): string {
  if (operational === 'completed') return 'Retorno concluído';
  if (operational === 'dismissed') return 'Retorno dispensado';
  if (operational === 'scheduled' && row.appointment_scheduled_at) return `Agendado para ${new Date(row.appointment_scheduled_at).toLocaleDateString('pt-BR')}`;
  if (temporal === 'overdue') {
    const days = daysBetweenIso(row.window_end, today);
    return `${days} dia${days === 1 ? '' : 's'} em atraso`;
  }
  if (temporal === 'available' || temporal === 'due_soon') {
    const left = daysBetweenIso(today, row.window_end);
    return left === 0 ? 'Último dia da janela' : `${left} dia${left === 1 ? '' : 's'} até o fim da janela`;
  }
  const until = daysBetweenIso(today, row.window_start);
  return `Disponível em ${until} dia${until === 1 ? '' : 's'}`;
}

function mapRow(row: ReturnRpcRow, today: string): RetornoInfo {
  const stateInput = {
    windowStart: row.window_start,
    windowEnd: row.window_end,
    contactedAt: row.contacted_at,
    appointmentId: row.appointment_id,
    appointmentStatus: row.appointment_status,
    completedAt: row.completed_at,
    dismissedAt: row.dismissed_at,
  };
  const temporalStatus = classifyReturnWindow(row.window_start, row.window_end, today);
  const operationalStatus = classifyReturnOperation(stateInput);
  return {
    id: row.id,
    patientId: row.patient_id,
    patientName: row.patient_name || 'Paciente',
    patientPhone: row.patient_phone,
    procedureId: row.procedure_id,
    procedureItemId: row.procedure_item_id,
    serviceId: row.service_id,
    serviceName: row.service_name,
    returnType: row.return_type,
    procedureDate: row.procedure_date,
    returnStartDays: row.return_start_days,
    returnEndDays: row.return_end_days,
    windowStartIso: row.window_start,
    windowEndIso: row.window_end,
    contactedAt: row.contacted_at,
    contactMethod: row.contact_method,
    appointmentId: row.appointment_id,
    appointmentStatus: row.appointment_status,
    appointmentScheduledAt: row.appointment_scheduled_at,
    completedAt: row.completed_at,
    dismissedAt: row.dismissed_at,
    dismissedReason: row.dismissed_reason,
    notes: row.notes,
    temporalStatus,
    operationalStatus,
    situationLabel: returnStatusLabel(temporalStatus, operationalStatus),
    needsAttention: returnNeedsAttention(stateInput, today),
    lastProcedureAt: dateAtNoon(row.procedure_date),
    serviceNames: [row.service_name],
    windowStart: dateAtNoon(row.window_start),
    windowEnd: dateAtNoon(row.window_end),
    status: legacyStatus(row, temporalStatus, operationalStatus, today),
    daysLabel: daysLabel(row, temporalStatus, operationalStatus, today),
  };
}

function friendlyReturnError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/jwt|session|auth|RETURN_SESSION_REQUIRED/i.test(message)) return 'Sua sessão expirou. Entre novamente para continuar.';
  if (/RETURN_NOT_FOUND|RETURN_NOT_OPEN|RETURN_ALREADY_CLOSED/i.test(message)) return 'Este retorno não está mais disponível para essa ação.';
  if (/RETURN_APPOINTMENT/i.test(message)) return 'Não foi possível vincular este agendamento ao retorno.';
  return fallback;
}

export function useRetornos(_servicos?: Service[]) {
  void _servicos;
  const [retornos, setRetornos] = useState<RetornoInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase.rpc('list_procedure_returns_v2');
      if (fetchError) throw fetchError;
      const today = clinicTodayIso();
      setRetornos(((data ?? []) as ReturnRpcRow[]).map(row => mapRow(row, today)));
    } catch (err) {
      console.error('[retornos] load failed', err);
      setRetornos([]);
      setError(friendlyReturnError(err, 'Não foi possível carregar os retornos.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const markContacted = useCallback(async (id: string, method: 'whatsapp' | 'phone' | 'other' | null = null) => {
    const { error: actionError } = await supabase.rpc('mark_procedure_return_contacted_v2', { p_return_id: id, p_method: method });
    if (actionError) {
      console.error('[retornos] contact failed', actionError);
      throw new Error(friendlyReturnError(actionError, 'Não foi possível marcar a paciente como contatada.'));
    }
    await refresh();
  }, [refresh]);

  const linkAppointment = useCallback(async (id: string, appointmentId: string) => {
    const { error: actionError } = await supabase.rpc('link_procedure_return_appointment', { p_return_id: id, p_appointment_id: appointmentId });
    if (actionError) {
      console.error('[retornos] appointment link failed', actionError);
      throw new Error(friendlyReturnError(actionError, 'Não foi possível vincular o agendamento ao retorno.'));
    }
    await refresh();
  }, [refresh]);

  const complete = useCallback(async (id: string) => {
    const { error: actionError } = await supabase.rpc('complete_procedure_return_v2', { p_return_id: id });
    if (actionError) {
      console.error('[retornos] complete failed', actionError);
      throw new Error(friendlyReturnError(actionError, 'Não foi possível concluir o retorno.'));
    }
    await refresh();
  }, [refresh]);

  const dismiss = useCallback(async (id: string, reason?: string | null) => {
    const { error: actionError } = await supabase.rpc('dismiss_procedure_return_v2', { p_return_id: id, p_reason: reason ?? null });
    if (actionError) {
      console.error('[retornos] dismiss failed', actionError);
      throw new Error(friendlyReturnError(actionError, 'Não foi possível dispensar o retorno.'));
    }
    await refresh();
  }, [refresh]);

  return { retornos, loading, error, refresh, markContacted, linkAppointment, complete, dismiss };
}
