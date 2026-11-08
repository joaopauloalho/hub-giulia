import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { agendaRange, clinicDateIso } from '../lib/agendaTime';
import { POSTGREST_SELECT } from '../lib/postgrestRelationshipHints';
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
type CalendarStatus = { connected?: boolean; needs_reauth?: boolean };

function sessionExpiredError() { return new Error('Sua sessão expirou. Entre novamente.'); }

function friendlyAgendaError(error: unknown) {
  const value = error as { code?: string; message?: string } | null;
  if (value?.code === '23P01' || /appointments_no_active_overlap|exclusion|APPOINTMENT_TIME_CONFLICT/i.test(value?.message ?? '')) {
    return new Error('Esse horário acabou de ser ocupado. Escolha outro horário.');
  }
  if (/APPOINTMENT_STATUS_TRANSITION_INVALID/i.test(value?.message ?? '')) {
    return new Error('Essa mudança de status não é permitida para este agendamento.');
  }
  return error instanceof Error ? error : new Error(value?.message ?? 'Não foi possível atualizar a agenda.');
}

function normalizeRange(input: AgendaRange | Date): AgendaRange {
  if (!(input instanceof Date)) return input;
  const range = agendaRange(clinicDateIso(input), 'day');
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
        .select(POSTGREST_SELECT.agenda)
        .gte('scheduled_at', range.from)
        .lt('scheduled_at', range.to)
        .order('scheduled_at');
      if (agendaError) throw agendaError;
      setAgendamentos((data ?? []) as AgendaAppointment[]);
    } catch (err) {
      setAgendamentos([]);
      setError(err instanceof Error ? err.message : 'Erro ao carregar agenda.');
    } finally { setLoading(false); }
  }, [range.from, range.to]);

  useEffect(() => { void refresh(); }, [refresh]);

  const syncGoogle = useCallback(async (id: string) => {
    // Connecting Apple explicitly suspends the previous Google exporter.
    // Until the read-only import has been reviewed, no remote calendar is written.
    const { data: appleStatus, error: appleError } = await supabase.functions.invoke<{ connected?: boolean }>(
      'icloud-calendar', { body: { action: 'status' } },
    );
    if (appleStatus?.connected) return;
    if (appleError) {
      const response = (appleError as { context?: Response }).context;
      // During rollout the new Edge Function may not yet be deployed (404);
      // preserve existing Google behaviour only in that specific case.
      if (response?.status !== 404) return;
    }
    const { data: calendarStatus, error: statusError } = await supabase.functions.invoke<CalendarStatus>('google-calendar-status', { body: {} });
    if (!statusError && (!calendarStatus?.connected || calendarStatus?.needs_reauth)) {
      const needsReauth = Boolean(calendarStatus?.needs_reauth);
      await supabase.from('appointments').update({
        google_sync_status: needsReauth ? 'error' : 'disconnected',
        google_sync_error_code: needsReauth ? 'google_reauth_required' : null,
      }).eq('id', id);
      await refresh();
      if (needsReauth) throw new Error('Agendamento salvo no Hub. Reconecte o Google Calendar para sincronizar.');
      return;
    }

    const { error: syncError } = await supabase.functions.invoke('google-calendar-upsert', { body: { appointment_id: id } });
    const syncedAt = new Date().toISOString();
    const syncMeta = syncError
      ? { google_sync_status: 'error', google_sync_error_code: 'google_sync_failed' }
      : { google_sync_status: 'synced', google_sync_error_code: null, google_last_synced_at: syncedAt };
    await supabase.from('appointments').update(syncMeta).eq('id', id);
    await refresh();
    if (syncError) throw new Error('Agendamento salvo no Hub, mas não sincronizado com o Google.');
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
    try { return await operation; }
    finally { if (createInFlightRef.current === operation) createInFlightRef.current = null; }
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
      .select(POSTGREST_SELECT.agendaConflict)
      .gte('scheduled_at', windowFrom)
      .lt('scheduled_at', windowTo)
      .in('status', ['pendente', 'confirmado']);
    if (ignoreId) query = query.neq('id', ignoreId);
    const { data, error: conflictError } = await query;
    if (conflictError) throw conflictError;
    const hubConflict = (data ?? []).find(row => {
      const rowStart = new Date(row.scheduled_at);
      const rowEnd = new Date(rowStart.getTime() + (row.duration_minutes ?? 60) * 60_000);
      return rowStart < end && rowEnd > start;
    });
    if (hubConflict) return hubConflict;

    // Check Apple live so an event just added on the iPhone is considered
    // even if the last periodic import has not happened yet.
    const { data: liveApple, error: liveError } = await supabase.functions.invoke<{
      connected?: boolean; checked?: boolean; conflict?: {scheduled_at: string} | null;
    }>('icloud-calendar', {body:{
      action:'check_conflict',starts_at:start.toISOString(),ends_at:end.toISOString(),
      ignore_appointment_id:ignoreId,
    }});
    if (!liveError && liveApple?.connected && liveApple.checked) {
      return liveApple.conflict ?? null;
    }
    // Fall back to locally imported events when the provider is temporarily offline.
    // Booking remains available, but the UI must not treat this as a guarantee
    // that the Apple calendar has no conflicting appointments.

    // Imported iCloud events also trigger the same advisory confirmation.
    // The end-exclusive condition allows adjacent appointments.
    const { data: appleEvents, error: appleError } = await supabase
      .from('icloud_calendar_events')
      .select('starts_at,ends_at')
      .lt('starts_at', end.toISOString())
      .gt('ends_at', start.toISOString())
      .eq('is_deleted', false)
      .is('linked_appointment_id', null)
      .order('starts_at')
      .limit(1);
    // Until the staging migration is deployed the Hub agenda stays usable.
    if (appleError) {
      const code = (appleError as { code?: string }).code;
      if (code === '42P01' || code === 'PGRST205') return null;
      throw appleError;
    }
    const first = appleEvents?.[0];
    return first ? { scheduled_at: first.starts_at } : null;
  };

  return { agendamentos, loading, error, create, update, confirm, cancel, markNoShow, retryGoogle, refresh, findConflict };
}
