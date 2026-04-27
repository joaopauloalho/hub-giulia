import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Contact } from '../types';

export function useContacts() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) setError(error.message);
    else setContacts(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const create = async (contact: Omit<Contact, 'id' | 'user_id' | 'created_at'>) => {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('contacts').insert({ ...contact, user_id: user!.id });
    if (error) throw error;
    await fetch();
  };

  const update = async (id: string, contact: Partial<Omit<Contact, 'id' | 'user_id' | 'created_at'>>) => {
    const { error } = await supabase.from('contacts').update(contact).eq('id', id);
    if (error) throw error;
    await fetch();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('contacts').delete().eq('id', id);
    if (error) throw error;
    await fetch();
  };

  return { contacts, loading, error, create, update, remove, refresh: fetch };
}
