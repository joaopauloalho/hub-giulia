import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Appointment } from '../types';

export interface AppointmentConflict {
  id: string;
  scheduled_at: string;
  patient?: { id: string; name: string } | null;
  service?: { duration_minutes: number | null } | null;
}

export function useAgenda(date: Date) {
  const [agendamentos, setAgendamentos] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);

      const { data, error: agendaError } = await supabase
        .from('appointments')
        .select('*, patient:patients(id,name,phone), service:services(id,name,duration_minutes)')
        .gte('scheduled_at', dayStart.toISOString())
        .lte('scheduled_at', dayEnd.toISOString())
        .order('scheduled_at');

      if (agendaError) throw agendaError;
      setAgendamentos(data ?? []);
    } catch (err) {
      setAgendamentos([]);
      setError(err instanceof Error ? err.message : 'Erro ao carregar agenda.');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { refresh(); }, [refresh]);

  const create = async (data: Omit<Appointment, 'id' | 'user_id' | 'created_at' | 'google_event_id' | 'patient' | 'service'>) => {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: row, error } = await supabase
      .from('appointments')
      .insert({ ...data, user_id: user!.id })
      .select()
      .single();
    if (error) throw error;
    await refresh();
    const apt = row as Appointment;

    // Best-effort Google Calendar sync — never blocks the main flow
    supabase.functions.invoke('google-calendar-upsert', {
      body: { appointment_id: apt.id },
    }).catch(() => {/* silent */});

    return apt;
  };

  const update = async (id: string, data: Partial<Omit<Appointment, 'id' | 'user_id' | 'created_at' | 'patient' | 'service'>>) => {
    const { error } = await supabase.from('appointments').update(data).eq('id', id);
    if (error) throw error;
    await refresh();

    supabase.functions.invoke('google-calendar-upsert', {
      body: { appointment_id: id },
    }).catch(() => {/* silent */});
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('appointments').delete().eq('id', id);
    if (error) throw error;
    await refresh();
  };

  const findConflict = async (
    scheduledAt: string,
    durationMinutes: number,
    ignoreId?: string,
  ): Promise<AppointmentConflict | null> => {
    const start = new Date(scheduledAt);
    const end = new Date(start.getTime() + durationMinutes * 60_000);
    const dayStart = new Date(start);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(start);
    dayEnd.setHours(23, 59, 59, 999);

    let query = supabase
      .from('appointments')
      .select('id, scheduled_at, patient:patients(id,name), service:services(duration_minutes), status')
      .gte('scheduled_at', dayStart.toISOString())
      .lte('scheduled_at', dayEnd.toISOString())
      .neq('status', 'cancelado');

    if (ignoreId) query = query.neq('id', ignoreId);

    const { data, error: conflictError } = await query;
    if (conflictError) throw conflictError;

    const rows = (data ?? []) as unknown as (AppointmentConflict & { status: string })[];
    return rows.find(row => {
      const rowStart = new Date(row.scheduled_at);
      const rowDuration = row.service?.duration_minutes ?? 60;
      const rowEnd = new Date(rowStart.getTime() + rowDuration * 60_000);
      return rowStart < end && rowEnd > start;
    }) ?? null;
  };

  return { agendamentos, loading, error, create, update, remove, refresh, findConflict };
}
