import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { agendaRange } from '../lib/agendaTime';
import type { Appointment } from '../types';

export type AgendaStatus = 'pendente' | 'confirmado' | 'realizado' | 'cancelado' | 'nao_compareceu';
export type GoogleSyncStatus = 'synced' | 'pending' | 'error' | 'disconnected';

export interface AgendaAppointment extends Omit<Appointment, 'status'> {
  status: AgendaStatus;
  duration_minutes: number | null;
  end_at: string | null;
  updated_at: string;
  confirmed_at: string | null;
  canceled_at: string | null;
  cancellation_reason: string | null;
  no_show_at: string | null;
  source: 'manual' | 'return';
  google_sync_status: GoogleSyncStatus;
  google_last_synced_at: string | null;
  google_sync_error_code: string | null;
  idempotency_key: string | null;
  previous_scheduled_at: string | null;
  previous_duration_minutes: number | null;
  last_rescheduled_at: string | null;
}

export interface AgendaInput {
  patient_id: string;
  service_id: string | null;
  scheduled_at: string;
  duration_minutes: number;
  status?: AgendaStatus;
  notes?: string | null;
  source?: 'manual' | 'return';
}

type AgendaRange = { from: string; to: string };

function sessionExpiredError() {
  return new Error('Sua sessão expirou. Entre novamente.');
}

function friendlyAgendaError(error: unknown) {
  const value = error as { code?: string; message?: string } | null;
  if (value?.code === '23P01' || /appointments_no_active_overlap|exclusion/i.test(value?.message ?? '')) {
    return new Error('Já existe um atendimento nesse horário.');
  }
  if (/APPOINTMENT_STATUS_TRANSITION_INVALID/i.test(value?.message ?? '')) {
    return new Error('Essa mudança de status não é permitida para este agendamento.');
  }
  return error instanceof Error ? error : new Error(value?.message ?? 'Não foi possível atualizar a agenda.');
}

function normalizeRange(input: AgendaRange | Date): AgendaRange {
  if (!(input instanceof Date)) return input;
  const dateIso = input.toISOString().slice(0, 10);
  const range = agendaRange(dateIso, 'day');
  return { from: range.from, to: range.to };
}

export function useAgenda(input: AgendaRange | Date) {
  const range = normalizeRange(input);
  const [agendamentos, setAgendamentos] = useState<AgendaAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const createKeyRef = useRef<string | null>(null);
  const createInFlightRef = useRef<Promise<AgendaAppointment> | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: agendaError } = await supabase
        .from('appointments')
        .select('*, patient:patients(id,name,phone), service:services(id,name,duration_minutes)')
        .gte('scheduled_at', range.from)
        .lt('scheduled_at', range.to)
        .order('scheduled_at');
      if (agendaError) throw agendaError;
      setAgendamentos((data ?? []) as AgendaAppointment[]);
    } catch (err) {
      setAgendamentos([]);
      setError(err instanceof Error ? err.message : 'Erro ao carregar agenda.');
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);

  useEffect(() => { void refresh(); }, [refresh]);

  const syncGoogle = useCallback(async (id: string) => {
    try {
      await supabase.functions.invoke('google-calendar-upsert', { body: { appointment_id: id } });
    } finally {
      await refresh();
    }
  }, [refresh]);

  const create = async (data: AgendaInput) => {
    if (createInFlightRef.current) return createInFlightRef.current;
    const operation = (async () => {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw sessionExpiredError();
      const key = createKeyRef.current ?? crypto.randomUUID();
      createKeyRef.current = key;
      const payload = {
        ...data,
        status: data.status ?? 'pendente',
        source: data.source ?? 'manual',
        notes: data.notes?.trim() || null,
        idempotency_key: key,
      };
      const { data: row, error: insertError } = await supabase.from('appointments').insert(payload).select().single();
      let appointment = row as AgendaAppointment | null;
      if (insertError) {
        const duplicateKey = (insertError as { code?: string }).code === '23505';
        if (duplicateKey) {
          const { data: existing } = await supabase.from('appointments').select('*').eq('idempotency_key', key).maybeSingle();
          appointment = existing as AgendaAppointment | null;
        }
        if (!appointment) throw friendlyAgendaError(insertError);
      }
      createKeyRef.current = null;
      await refresh();
      void syncGoogle(appointment!.id).catch(() => undefined);
      return appointment!;
    })();
    createInFlightRef.current = operation;
    try {
      return await operation;
    } finally {
      if (createInFlightRef.current === operation) createInFlightRef.current = null;
    }
  };

  const update = async (id: string, data: Partial<AgendaInput & { cancellation_reason: string | null }>) => {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) throw sessionExpiredError();
    const { data: row, error: updateError } = await supabase.from('appointments').update(data).eq('id', id).select().single();
    if (updateError) throw friendlyAgendaError(updateError);
    await refresh();
    void syncGoogle(id).catch(() => undefined);
    return row as AgendaAppointment;
  };

  const confirm = (id: string) => update(id, { status: 'confirmado' });
  const cancel = (id: string, reason?: string | null) => update(id, { status: 'cancelado', cancellation_reason: reason?.trim() || null });
  const markNoShow = (id: string) => update(id, { status: 'nao_compareceu' });
  const retryGoogle = async (id: string) => { await syncGoogle(id); };

  const findConflict = async (scheduledAt: string, durationMinutes: number, ignoreId?: string) => {
    const start = new Date(scheduledAt);
    const end = new Date(start.getTime() + durationMinutes * 60_000);
    const windowFrom = new Date(start.getTime() - 24 * 60 * 60_000).toISOString();
    const windowTo = new Date(end.getTime() + 24 * 60 * 60_000).toISOString();
    let query = supabase
      .from('appointments')
      .select('id, scheduled_at, duration_minutes, status, patient:patients(id,name)')
      .gte('scheduled_at', windowFrom)
      .lt('scheduled_at', windowTo)
      .in('status', ['pendente', 'confirmado']);
    if (ignoreId) query = query.neq('id', ignoreId);
    const { data, error: conflictError } = await query;
    if (conflictError) throw conflictError;
    return (data ?? []).find(row => {
      const rowStart = new Date(row.scheduled_at);
      const rowEnd = new Date(rowStart.getTime() + (row.duration_minutes ?? 60) * 60_000);
      return rowStart < end && rowEnd > start;
    }) ?? null;
  };

  return { agendamentos, loading, error, create, update, confirm, cancel, markNoShow, retryGoogle, refresh, findConflict };
}
