import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Patient } from '../types';

export function usePacientes() {
  const [pacientes, setPacientes] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: patientsError } = await supabase
        .from('patients')
        .select('*')
        .order('created_at', { ascending: false });

      if (patientsError) throw patientsError;
      setPacientes(data ?? []);
    } catch (err) {
      setPacientes([]);
      setError(err instanceof Error ? err.message : 'Erro ao carregar pacientes.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const create = async (data: Omit<Patient, 'id' | 'user_id' | 'created_at'>) => {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: row, error } = await supabase
      .from('patients')
      .insert({ ...data, user_id: user!.id })
      .select()
      .single();
    if (error) throw error;
    await refresh();
    return row as Patient;
  };

  const update = async (id: string, data: Partial<Omit<Patient, 'id' | 'user_id' | 'created_at'>>) => {
    const { error } = await supabase.from('patients').update(data).eq('id', id);
    if (error) throw error;
    await refresh();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('patients').delete().eq('id', id);
    if (error) throw error;
    await refresh();
  };

  return { pacientes, loading, error, create, update, remove, refresh };
}
