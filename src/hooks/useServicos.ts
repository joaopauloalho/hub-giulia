import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Service } from '../types';

export function useServicos() {
  const [servicos, setServicos] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: servicesError } = await supabase
        .from('services')
        .select('*')
        .order('name');

      if (servicesError) throw servicesError;
      setServicos(data ?? []);
    } catch (err) {
      setServicos([]);
      setError(err instanceof Error ? err.message : 'Erro ao carregar serviços.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const create = async (data: Omit<Service, 'id' | 'user_id' | 'created_at'>) => {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: row, error } = await supabase
      .from('services')
      .insert({ ...data, user_id: user!.id })
      .select()
      .single();
    if (error) throw error;
    await refresh();
    return row as Service;
  };

  const update = async (id: string, data: Partial<Omit<Service, 'id' | 'user_id' | 'created_at'>>) => {
    const { error } = await supabase.from('services').update(data).eq('id', id);
    if (error) throw error;
    await refresh();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('services').delete().eq('id', id);
    if (error) throw error;
    await refresh();
  };

  const toggle = async (id: string, active: boolean) => {
    await update(id, { active });
  };

  return { servicos, loading, error, create, update, remove, toggle, refresh };
}
