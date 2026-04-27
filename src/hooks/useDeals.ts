import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Deal } from '../types';

export function useDeals() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('deals')
      .select('*, contact:contacts(id, name, company)')
      .order('created_at', { ascending: false });
    if (error) setError(error.message);
    else setDeals(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const create = async (deal: Omit<Deal, 'id' | 'user_id' | 'created_at' | 'contact'>) => {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('deals').insert({ ...deal, user_id: user!.id });
    if (error) throw error;
    await fetch();
  };

  const update = async (id: string, deal: Partial<Omit<Deal, 'id' | 'user_id' | 'created_at' | 'contact'>>) => {
    const { error } = await supabase.from('deals').update(deal).eq('id', id);
    if (error) throw error;
    await fetch();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('deals').delete().eq('id', id);
    if (error) throw error;
    await fetch();
  };

  return { deals, loading, error, create, update, remove, refresh: fetch };
}
