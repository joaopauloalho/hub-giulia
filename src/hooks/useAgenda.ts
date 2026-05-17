import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Appointment } from '../types';

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
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('appointments').delete().eq('id', id);
    if (error) throw error;
    await refresh();
  };

  return { agendamentos, loading, error, create, update, remove, refresh };
}
