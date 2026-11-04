import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import {
  normalizePatientCreateData,
  patientCreateFriendlyError,
  SESSION_EXPIRED_MESSAGE,
  validatePatientCreateData,
  type PatientCreateData,
} from '../lib/patientInput';
import type { Patient } from '../types';

type ArchiveMode = 'active' | 'archived' | 'all';
export type PatientRecord = Patient & { archived_at: string | null };

interface UsePacientesOptions {
  pageSize?: number;
  search?: string;
  archiveMode?: ArchiveMode;
}

export function usePacientes(options: UsePacientesOptions = {}) {
  const pageSize = options.pageSize ?? 50;
  const search = options.search?.trim() ?? '';
  const archiveMode = options.archiveMode ?? 'active';
  const [pacientes, setPacientes] = useState<PatientRecord[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const loadPage = useCallback(async (nextPage: number, append: boolean) => {
    const requestId = ++requestIdRef.current;
    if (!append) setLoading(true);
    setError(null);

    try {
      const from = nextPage * pageSize;
      const to = from + pageSize - 1;
      let rows: PatientRecord[];
      let count: number | null;

      if (search) {
        // Server-side unaccent search covers all pages, not only loaded patients.
        const result = await supabase
          .rpc('search_patients_v1', { p_search: search, p_archive_mode: archiveMode }, { count: 'exact' })
          .order(archiveMode === 'archived' ? 'archived_at' : 'created_at', { ascending: false })
          .range(from, to);
        if (result.error) throw result.error;
        rows = (result.data ?? []) as PatientRecord[];
        count = result.count;
      } else {
        let query = supabase
          .from('patients')
          .select('*', { count: 'exact' })
          .order(archiveMode === 'archived' ? 'archived_at' : 'created_at', { ascending: false })
          .range(from, to);

        if (archiveMode === 'active') query = query.is('archived_at', null);
        if (archiveMode === 'archived') query = query.not('archived_at', 'is', null);

        const result = await query;
        if (result.error) throw result.error;
        rows = (result.data ?? []) as PatientRecord[];
        count = result.count;
      }

      // Older requests must not overwrite newer results during rapid typing.
      if (requestId !== requestIdRef.current) return;
      setPacientes(current => append ? [...current, ...rows] : rows);
      setTotal(count ?? 0);
      setPage(nextPage);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      if (!append) setPacientes([]);
      console.error('[usePacientes.load]', err);
      setError('Não foi possível carregar as pacientes.');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [archiveMode, pageSize, search]);

  const refresh = useCallback(async () => {
    await loadPage(0, false);
  }, [loadPage]);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = async (data: PatientCreateData) => {
    const normalized = normalizePatientCreateData(data);
    const validationError = validatePatientCreateData(normalized);
    if (validationError) throw new Error(validationError);

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      console.error('[usePacientes.create] user validation failed', authError);
      throw new Error(SESSION_EXPIRED_MESSAGE);
    }

    const { data: row, error: insertError } = await supabase
      .from('patients')
      .insert({ ...normalized, user_id: authData.user.id })
      .select()
      .single();

    if (insertError) {
      console.error('[usePacientes.create] Supabase insert failed', insertError);
      throw new Error(patientCreateFriendlyError(insertError));
    }

    await refresh();
    return row as PatientRecord;
  };

  const update = async (id: string, data: Partial<Omit<Patient, 'id' | 'user_id' | 'created_at'>>) => {
    const { error: updateError } = await supabase.from('patients').update(data).eq('id', id);
    if (updateError) throw updateError;
    await refresh();
  };

  const archive = async (id: string) => {
    const { error: archiveError } = await supabase
      .from('patients')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', id);
    if (archiveError) throw archiveError;
    await refresh();
  };

  const restore = async (id: string) => {
    const { error: restoreError } = await supabase
      .from('patients')
      .update({ archived_at: null })
      .eq('id', id);
    if (restoreError) throw restoreError;
    await refresh();
  };

  const getById = useCallback(async (id: string): Promise<PatientRecord | null> => {
    const local = pacientes.find(patient => patient.id === id);
    if (local) return local;

    const { data, error: patientError } = await supabase
      .from('patients')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (patientError) throw patientError;
    return data as PatientRecord | null;
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
    archive,
    restore,
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
