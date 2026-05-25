import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Patient } from '../types';

interface UsePacientesOptions {
  pageSize?: number;
  search?: string;
}

export function usePacientes(options: UsePacientesOptions = {}) {
  const pageSize = options.pageSize ?? 50;
  const search = options.search?.trim() ?? '';
  const [pacientes, setPacientes] = useState<Patient[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(async (nextPage: number, append: boolean) => {
    if (!append) setLoading(true);
    setError(null);

    try {
      const from = nextPage * pageSize;
      const to = from + pageSize - 1;
      let query = supabase
        .from('patients')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);

      if (search.length >= 3) {
        const term = `%${search.replace(/[%_]/g, '\\$&')}%`;
        query = query.or(`name.ilike.${term},phone.ilike.${term},email.ilike.${term}`);
      }

      const { data, error: patientsError, count } = await query;

      if (patientsError) throw patientsError;
      setPacientes(current => append ? [...current, ...((data ?? []) as Patient[])] : ((data ?? []) as Patient[]));
      setTotal(count ?? 0);
      setPage(nextPage);
    } catch (err) {
      if (!append) setPacientes([]);
      setError(err instanceof Error ? err.message : 'Erro ao carregar pacientes.');
    } finally {
      setLoading(false);
    }
  }, [pageSize, search]);

  const refresh = useCallback(async () => {
    await loadPage(0, false);
  }, [loadPage]);

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

  const getById = useCallback(async (id: string): Promise<Patient | null> => {
    const local = pacientes.find(patient => patient.id === id);
    if (local) return local;

    const { data, error: patientError } = await supabase
      .from('patients')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (patientError) throw patientError;
    return data as Patient | null;
  }, [pacientes]);

  const nextPage = async () => {
    if ((page + 1) * pageSize >= total) return;
    await loadPage(page + 1, true);
  };

  const prevPage = async () => {
    await loadPage(Math.max(page - 1, 0), false);
  };

  return {
    pacientes,
    loading,
    error,
    create,
    update,
    remove,
    getById,
    refresh,
    total,
    page,
    pageSize,
    nextPage,
    prevPage,
    hasMore: (page + 1) * pageSize < total,
  };
}
