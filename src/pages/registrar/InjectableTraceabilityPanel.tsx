import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, Loader2, ShieldCheck, X } from 'lucide-react';
import { useProductTraceabilityEvidence } from '../../hooks/useProductTraceabilityEvidence';
import { formatTraceabilityExpiry, isExpiredTraceabilityDate } from '../../lib/productTraceability';
import type { ProductEvidenceDraft } from '../../types/traceability';

interface Props {
  patientId: string;
  mapId: string;
  applicationId: string;
  productName: string;
  lotNumber?: string | null;
  expiresOn?: string | null;
}

export function InjectableTraceabilityPanel({ patientId, mapId, applicationId, productName, lotNumber, expiresOn }: Props) {
  const { uploadEvidence, discardEvidence, listDraftEvidenceForMap } = useProductTraceabilityEvidence();
  const [evidence, setEvidence] = useState<ProductEvidenceDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const cameraInput = useRef<HTMLInputElement | null>(null);
  const libraryInput = useRef<HTMLInputElement | null>(null);
  const expired = isExpiredTraceabilityDate(expiresOn);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void listDraftEvidenceForMap(patientId, mapId)
      .then(rows => {
        if (!active) return;
        setEvidence(rows.find(row => row.draft_application_id === applicationId) ?? null);
      })
      .catch(cause => {
        if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar a foto do produto.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [applicationId, listDraftEvidenceForMap, mapId, patientId]);

  const attach = async (file: File | undefined, sourceType: 'camera' | 'library') => {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      if (evidence && !evidence.traceability_id) await discardEvidence(evidence);
      const uploaded = await uploadEvidence({
        patientId,
        file,
        sourceType,
        draftMapId: mapId,
        draftApplicationId: applicationId,
      });
      setEvidence(uploaded);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível enviar a foto. Tente novamente.');
    } finally {
      setUploading(false);
    }
  };

  const remove = async () => {
    if (!evidence) return;
    setUploading(true);
    setError('');
    try {
      await discardEvidence(evidence);
      setEvidence(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível remover a foto.');
    } finally {
      setUploading(false);
    }
  };

  return <div style={{ marginTop: 12, padding: 12, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}><ShieldCheck size={15} style={{ color: 'var(--primary)' }} /><strong style={{ fontSize: 12 }}>Rastreabilidade do produto</strong></div>
    <p style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.45, marginBottom: 9 }}>Fotografe o rótulo deixando lote e validade visíveis. A foto é opcional.</p>

    {(lotNumber || expiresOn) && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, marginBottom: 8 }}>
      {lotNumber && <span style={{ padding: '4px 7px', borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--border)' }}>Lote <strong>{lotNumber}</strong></span>}
      {expiresOn && <span style={{ padding: '4px 7px', borderRadius: 8, background: expired ? '#fef2f2' : 'var(--bg-2)', border: `1px solid ${expired ? '#fecaca' : 'var(--border)'}`, color: expired ? '#b91c1c' : 'inherit' }}>Val. <strong>{formatTraceabilityExpiry(expiresOn)}</strong></span>}
    </div>}
    {expired && <div style={{ marginBottom: 9, padding: '8px 9px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#b91c1c', fontSize: 11, fontWeight: 800 }}>⚠ Este lote está vencido. Confira antes de continuar.</div>}

    {loading ? <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-3)' }}><Loader2 size={13} className="spin" /> Carregando evidência…</div> : evidence ? <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: 8, borderRadius: 9, background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
      {evidence.previewUrl && <img src={evidence.previewUrl} alt={`Rótulo de ${productName}`} style={{ width: 56, height: 56, borderRadius: 7, objectFit: 'cover', border: '1px solid var(--border)' }} />}
      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 11, fontWeight: 800, color: '#166534' }}>Foto anexada ✓</div><div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>Será vinculada ao atendimento somente na confirmação final.</div></div>
      <button type="button" className="injectables-mini-button" onClick={() => void remove()} disabled={uploading} aria-label="Remover foto do produto"><X size={14} /></button>
    </div> : <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
      <button type="button" className="btn btn--secondary btn--sm" onClick={() => cameraInput.current?.click()} disabled={uploading}>{uploading ? <Loader2 size={14} className="spin" /> : <Camera size={14} />} Fotografar rótulo</button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => libraryInput.current?.click()} disabled={uploading}><ImagePlus size={14} /> Biblioteca</button>
    </div>}
    <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={event => { const file = event.currentTarget.files?.[0]; void attach(file, 'camera'); event.currentTarget.value = ''; }} />
    <input ref={libraryInput} type="file" accept="image/*" hidden onChange={event => { const file = event.currentTarget.files?.[0]; void attach(file, 'library'); event.currentTarget.value = ''; }} />
    {error && <p style={{ marginTop: 8, color: 'var(--red)', fontSize: 11, fontWeight: 700 }}>{error}</p>}
  </div>;
}
