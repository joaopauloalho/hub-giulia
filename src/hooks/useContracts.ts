import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Contract } from '../types';

export function useContracts(patientId: string) {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('contracts')
      .select('*, template:contract_templates(name)')
      .eq('patient_id', patientId)
      .order('signed_at', { ascending: false });
    setContracts((data as Contract[]) ?? []);
    setLoading(false);
  }, [patientId]);

  const save = async (opts: {
    template_id: string | null;
    signature_data: string;
    pdf_url?: string;
  }) => {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('contracts').insert({
      patient_id: patientId,
      user_id: user!.id,
      template_id: opts.template_id,
      signature_data: opts.signature_data,
      pdf_url: opts.pdf_url ?? null,
      signed_at: new Date().toISOString(),
    });
    if (error) throw error;
    await load();
  };

  const uploadPdf = async (blob: Blob, contractId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    const path = `${user!.id}/${patientId}/${contractId}.pdf`;
    const { error } = await supabase.storage
      .from('contracts')
      .upload(path, blob, { contentType: 'application/pdf', upsert: true });
    if (error) throw error;
    const { data } = supabase.storage.from('contracts').getPublicUrl(path);
    return data.publicUrl;
  };

  return { contracts, loading, load, save, uploadPdf };
}
