import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Contract } from '../types';
import { createSignedStorageUrl } from '../lib/storage';
import { POSTGREST_SELECT } from '../lib/postgrestRelationshipHints';

export function useContracts(patientId: string) {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: contractsError } = await supabase
        .from('contracts')
        .select(POSTGREST_SELECT.contracts)
        .eq('patient_id', patientId)
        .order('signed_at', { ascending: false });

      if (contractsError) throw contractsError;

      const signedContracts = await Promise.all(
        ((data ?? []) as Contract[]).map(async contract => ({
          ...contract,
          pdf_url: await createSignedStorageUrl('contracts', contract.pdf_url),
        }))
      );

      setContracts(signedContracts);
    } catch (err) {
      setContracts([]);
      setError(err instanceof Error ? err.message : 'Erro ao carregar contratos.');
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  const save = async (opts: {
    template_id: string | null;
    signature_data: string;
    pdf_url?: string;
  }) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Usuario nao autenticado.');

    const { error } = await supabase.from('contracts').insert({
      patient_id: patientId,
      user_id: user.id,
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
    if (!user) throw new Error('Usuario nao autenticado.');

    const path = `${user.id}/${patientId}/${contractId}.pdf`;
    const { error } = await supabase.storage
      .from('contracts')
      .upload(path, blob, { contentType: 'application/pdf', upsert: true });
    if (error) throw error;
    return path;
  };

  return { contracts, loading, error, load, save, uploadPdf };
}
