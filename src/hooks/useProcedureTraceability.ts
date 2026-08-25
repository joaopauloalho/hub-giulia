import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { PRODUCT_EVIDENCE_BUCKET } from '../lib/productTraceability';
import type { ProcedureProductTraceability, ProcedureTraceabilityWithEvidence, ProductEvidenceDraft } from '../types/traceability';

export function useProcedureTraceability(patientId: string) {
  const [records, setRecords] = useState<ProcedureTraceabilityWithEvidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [traceResponse, evidenceResponse] = await Promise.all([
        supabase
          .from('procedure_product_traceability')
          .select('*')
          .eq('patient_id', patientId)
          .order('performed_at_snapshot', { ascending: false }),
        supabase
          .from('product_traceability_evidence')
          .select('*')
          .eq('patient_id', patientId)
          .not('traceability_id', 'is', null)
          .is('voided_at', null)
          .order('created_at', { ascending: false }),
      ]);
      if (traceResponse.error) throw traceResponse.error;
      if (evidenceResponse.error) throw evidenceResponse.error;

      const evidences = (evidenceResponse.data ?? []) as ProductEvidenceDraft[];
      const evidenceByTraceability = new Map<string, ProductEvidenceDraft>();
      for (const evidence of evidences) {
        if (!evidence.traceability_id || evidenceByTraceability.has(evidence.traceability_id)) continue;
        const { data: signed, error: signedError } = await supabase.storage
          .from(PRODUCT_EVIDENCE_BUCKET)
          .createSignedUrl(evidence.thumbnail_path, 60 * 15);
        evidenceByTraceability.set(evidence.traceability_id, {
          ...evidence,
          previewUrl: signedError ? null : signed.signedUrl,
        });
      }

      setRecords(((traceResponse.data ?? []) as ProcedureProductTraceability[]).map(record => ({
        ...record,
        quantity_snapshot: Number(record.quantity_snapshot),
        evidence: evidenceByTraceability.get(record.id) ?? null,
      })));
    } catch (cause) {
      console.error('[traceability:patient-history]', cause);
      setRecords([]);
      setError('Não foi possível carregar a rastreabilidade dos atendimentos.');
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const byProcedure = useMemo(() => {
    const grouped = new Map<string, ProcedureTraceabilityWithEvidence[]>();
    for (const record of records) {
      grouped.set(record.procedure_id_snapshot, [...(grouped.get(record.procedure_id_snapshot) ?? []), record]);
    }
    return grouped;
  }, [records]);

  return { records, byProcedure, loading, error, refresh };
}
