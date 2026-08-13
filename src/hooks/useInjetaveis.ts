import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { InjectableMap, InjectablePoint } from '../types';
import { consumeAtomicAttendanceProcedure } from '../lib/attendanceRuntime';

export function useInjetaveis(patientId?: string) {
  const [maps, setMaps] = useState<InjectableMap[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('injectable_maps')
        .select('*')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false });
      if (err) throw err;
      setMaps((data ?? []) as InjectableMap[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar mapas de injetáveis.');
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  const save = async (
    patientId: string,
    points: InjectablePoint[],
    procedureId?: string,
  ): Promise<InjectableMap> => {
    if (procedureId && consumeAtomicAttendanceProcedure(procedureId)) {
      const { data, error: existingError } = await supabase
        .from('injectable_maps')
        .select('*')
        .eq('patient_id', patientId)
        .eq('procedure_id', procedureId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (existingError) throw existingError;
      return data as InjectableMap;
    }

    const { data: { user } } = await supabase.auth.getUser();
    const { data, error: err } = await supabase
      .from('injectable_maps')
      .insert({
        patient_id: patientId,
        procedure_id: procedureId ?? null,
        user_id: user!.id,
        points,
      })
      .select()
      .single();
    if (err) throw err;
    return data as InjectableMap;
  };

  const linkProcedure = async (mapId: string, procedureId: string) => {
    const { error: err } = await supabase
      .from('injectable_maps')
      .update({ procedure_id: procedureId })
      .eq('id', mapId);
    if (err) throw err;
  };

  const remove = async (mapId: string) => {
    const { error: err } = await supabase
      .from('injectable_maps')
      .delete()
      .eq('id', mapId);
    if (err) throw err;
    setMaps(prev => prev.filter(m => m.id !== mapId));
  };

  return { maps, loading, error, load, save, linkProcedure, remove };
}
