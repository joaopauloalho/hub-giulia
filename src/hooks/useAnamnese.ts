import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Anamnesis } from '../types';

export function useAnamnese(patientId: string) {
  const [anamnese, setAnamnese] = useState<Anamnesis | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('anamnesis')
      .select('*')
      .eq('patient_id', patientId)
      .maybeSingle();
    setAnamnese(data ?? null);
    setLoading(false);
  }, [patientId]);

  const save = async (data: Omit<Anamnesis, 'id' | 'user_id' | 'updated_at'>) => {
    const { data: { user } } = await supabase.auth.getUser();
    const payload = { ...data, user_id: user!.id, updated_at: new Date().toISOString() };

    if (anamnese?.id) {
      const { error } = await supabase
        .from('anamnesis')
        .update(payload)
        .eq('id', anamnese.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('anamnesis').insert(payload);
      if (error) throw error;
    }
    await load();
  };

  return { anamnese, loading, load, save };
}
