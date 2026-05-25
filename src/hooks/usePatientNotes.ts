import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import type { PatientNote } from '../types';

interface UsePatientNotesOptions {
  patientId?: string;
  remindAt?: Date;
}

export function usePatientNotes(options: UsePatientNotesOptions = {}) {
  const { patientId, remindAt } = options;
  const [notes, setNotes] = useState<PatientNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from('patient_notes')
        .select('*, patient:patients(id,name)')
        .order('created_at', { ascending: false });

      if (patientId) query = query.eq('patient_id', patientId);
      if (remindAt) query = query.eq('remind_at', format(remindAt, 'yyyy-MM-dd')).eq('resolved', false);

      const { data, error: notesError } = await query;
      if (notesError) throw notesError;
      setNotes((data ?? []) as PatientNote[]);
    } catch (err) {
      setNotes([]);
      setError(err instanceof Error ? err.message : 'Erro ao carregar notas.');
    } finally {
      setLoading(false);
    }
  }, [patientId, remindAt]);

  useEffect(() => { refresh(); }, [refresh]);

  const create = async (input: { patient_id: string; content: string; remind_at: string | null }) => {
    const { data: { user } } = await supabase.auth.getUser();
    const { error: insertError } = await supabase.from('patient_notes').insert({
      ...input,
      user_id: user!.id,
    });
    if (insertError) throw insertError;
    await refresh();
  };

  const update = async (id: string, data: Partial<Pick<PatientNote, 'content' | 'remind_at' | 'resolved'>>) => {
    const { error: updateError } = await supabase.from('patient_notes').update(data).eq('id', id);
    if (updateError) throw updateError;
    await refresh();
  };

  const remove = async (id: string) => {
    const { error: deleteError } = await supabase.from('patient_notes').delete().eq('id', id);
    if (deleteError) throw deleteError;
    await refresh();
  };

  return { notes, loading, error, create, update, remove, refresh };
}
