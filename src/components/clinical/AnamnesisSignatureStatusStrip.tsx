import { useEffect, useState } from 'react';
import { ClipboardList, ShieldCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export function AnamnesisSignatureStatusStrip({ patientId }: { patientId: string }) {
  const [state, setState] = useState<{ anamnesis: string; signature: string } | null>(null);
  useEffect(() => {
    let active = true;
    void (async () => {
      const [currentResult, versionResult] = await Promise.all([
        supabase.from('anamnesis').select('status').eq('patient_id', patientId).maybeSingle(),
        supabase.from('anamnesis_versions').select('id').eq('patient_id', patientId).order('version_number', { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (!active || currentResult.error || versionResult.error) return;
      const versionId = versionResult.data?.id as string | undefined;
      let signed = false;
      if (versionId) {
        const signatureResult = await supabase.from('anamnesis_signatures').select('id').eq('anamnesis_version_id', versionId).maybeSingle();
        if (!active) return;
        signed = Boolean(signatureResult.data?.id);
      }
      const currentStatus = currentResult.data?.status as string | undefined;
      setState({
        anamnesis: currentStatus === 'completed' ? 'Concluída' : currentStatus === 'draft' ? 'Rascunho' : 'Sem anamnese',
        signature: versionId ? (signed ? 'Assinada' : 'Pendente') : 'Sem versão',
      });
    })();
    return () => { active = false; };
  }, [patientId]);
  if (!state) return null;
  return <div className="card" style={{ padding: 12, marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }} aria-label="Estado da anamnese para injetáveis">
    <span className={`badge ${state.anamnesis === 'Concluída' ? 'badge--green' : 'badge--rose'}`}><ClipboardList size={12} style={{ marginRight: 4 }} />Anamnese: {state.anamnesis}</span>
    <span className={`badge ${state.signature === 'Assinada' ? 'badge--green' : ''}`}><ShieldCheck size={12} style={{ marginRight: 4 }} />Assinatura: {state.signature}</span>
    <span className="page-sub">Esses estados são informativos e não bloqueiam o mapa clínico.</span>
  </div>;
}
