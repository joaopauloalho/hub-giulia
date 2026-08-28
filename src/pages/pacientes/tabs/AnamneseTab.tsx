import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Clock3, Copy, ExternalLink, FileCheck2, PencilLine, Send, ShieldCheck, Smartphone, Tablet, Unlink } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import {
  buildAnamnesisSignatureUrl,
  createAnamnesisSignatureLink,
  revokeAnamnesisSignatureLink,
  type AnamnesisSignatureDeliveryMode,
  type AnamnesisSignatureLinkRow,
  type AnamnesisSignatureRow,
} from '../../../lib/anamnesisSignature';
import type { AnamnesisCurrentRow, AnamnesisVersion } from '../../../lib/anamnesisV2';
import { useToast } from '../../../hooks/useToast';
import { Modal } from '../../../components/ui/Modal';
import '../anamnese-signature-flow.css';

interface Props { patientId: string; }
type SchemaField = { key?: string; label?: string; type?: string; detail_key?: string };
type SchemaSection = { key?: string; title?: string; fields?: SchemaField[] };
type GeneratedLink = { url: string; mode: Exclude<AnamnesisSignatureDeliveryMode, 'legacy'>; expiresAt: string };

const dateTime = (value: string | null | undefined) => value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

function sectionAnswers(snapshot: Record<string, unknown>, sectionKey: string) {
  if (sectionKey === 'conditions') return (snapshot.conditions ?? {}) as Record<string, unknown>;
  if (['medical_history', 'womens_health', 'allergies', 'intolerances'].includes(sectionKey)) return (snapshot.surgical_history ?? {}) as Record<string, unknown>;
  if (['habits', 'food', 'routine'].includes(sectionKey)) return (snapshot.habits ?? {}) as Record<string, unknown>;
  if (['aesthetics', 'procedures', 'skin_review'].includes(sectionKey)) return (snapshot.aesthetics ?? {}) as Record<string, unknown>;
  return snapshot;
}

function displayValue(snapshot: Record<string, unknown>, sectionKey: string, field: SchemaField) {
  const key = field.key ?? '';
  const source = sectionAnswers(snapshot, sectionKey);
  const value = source[key];
  if (field.type === 'status_text') {
    const statusKey = key === 'allergies' ? 'allergies_status' : 'medications_status';
    const status = snapshot[statusKey];
    if (status === 'none') return key === 'allergies' ? 'Não possui' : 'Não utiliza';
    if (status === 'reported') return String(snapshot[key] ?? '').trim() || 'Informado sem descrição';
    return 'Sem resposta registrada';
  }
  if (field.type === 'text_legacy') return String(snapshot[key] ?? '').trim() || 'Não informado no modelo legado';
  if (['boolean', 'boolean_detail', 'boolean_frequency', 'procedure_note'].includes(field.type ?? '')) {
    if (value === true) {
      if (field.detail_key) {
        const detail = String(source[field.detail_key] ?? '').trim();
        return detail ? `Sim — ${detail}` : 'Sim';
      }
      return 'Sim';
    }
    if (value === false) {
      if (field.type === 'procedure_note' && field.detail_key) {
        const detail = String(source[field.detail_key] ?? '').trim();
        if (detail) return `Não — ${detail}`;
      }
      return 'Não';
    }
    return 'Sem resposta registrada';
  }
  if (value === null || value === undefined || value === '') return 'Não informado';
  return String(value);
}

function HistoricalVersion({ version }: { version: AnamnesisVersion }) {
  const sections = ((version.form_schema_snapshot.sections ?? []) as SchemaSection[]).filter(section => Array.isArray(section.fields));
  return <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
    <div className="page-sub">Documento somente leitura · schema {version.form_schema_version}{version.migration_source === 'legacy' ? ' · migrado do modelo anterior' : ''}</div>
    {sections.map((section, index) => <div className="card" key={`${section.key ?? index}`} style={{ padding: 12 }}><strong style={{ display: 'block', marginBottom: 8 }}>{section.title ?? 'Seção'}</strong><div style={{ display: 'grid', gap: 6 }}>{(section.fields ?? []).map((field, i) => <div key={`${field.key ?? i}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(150px,.8fr) minmax(0,1.2fr)', gap: 10, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}><span className="page-sub">{field.label ?? field.key}</span><span style={{ fontSize: 13, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{displayValue(version.answers_snapshot, section.key ?? '', field)}</span></div>)}</div></div>)}
  </div>;
}

export function AnamneseTab({ patientId }: Props) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast, confirm } = useToast();
  const [current, setCurrent] = useState<AnamnesisCurrentRow | null>(null);
  const [versions, setVersions] = useState<AnamnesisVersion[]>([]);
  const [links, setLinks] = useState<AnamnesisSignatureLinkRow[]>([]);
  const [signatures, setSignatures] = useState<AnamnesisSignatureRow[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [generatedLink, setGeneratedLink] = useState<GeneratedLink | null>(null);
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [currentResult, versionsResult, linksResult, signaturesResult] = await Promise.all([
        supabase.from('anamnesis').select('*').eq('patient_id', patientId).maybeSingle(),
        supabase.from('anamnesis_versions').select('id,anamnesis_id,user_id,patient_id,version_number,form_schema_version,answers_snapshot,form_schema_snapshot,completed_at,author_user_id,source_type,migration_source,supersedes_version_id,created_at').eq('patient_id', patientId).order('version_number', { ascending: false }),
        supabase.from('anamnesis_signature_links').select('id,user_id,patient_id,anamnesis_version_id,delivery_mode,expires_at,revoked_at,consumed_at,created_at').eq('patient_id', patientId).order('created_at', { ascending: false }),
        supabase.from('anamnesis_signatures').select('id,anamnesis_version_id,signed_at').eq('patient_id', patientId).order('signed_at', { ascending: false }),
      ]);
      if (currentResult.error) throw currentResult.error;
      if (versionsResult.error) throw versionsResult.error;
      if (linksResult.error) throw linksResult.error;
      if (signaturesResult.error) throw signaturesResult.error;
      const nextCurrent = (currentResult.data ?? null) as AnamnesisCurrentRow | null;
      const nextVersions = (versionsResult.data ?? []) as AnamnesisVersion[];
      setCurrent(nextCurrent);
      setVersions(nextVersions);
      setLinks((linksResult.data ?? []) as AnamnesisSignatureLinkRow[]);
      setSignatures((signaturesResult.data ?? []) as AnamnesisSignatureRow[]);
      const requested = Number(searchParams.get('version') ?? 0);
      setSelectedVersionId(nextVersions.find(version => version.version_number === requested)?.id ?? null);
    } catch {
      setError('Não foi possível carregar a anamnese.');
    } finally {
      setLoading(false);
    }
  }, [patientId, searchParams]);

  useEffect(() => { void load(); }, [load]);

  const latest = versions[0] ?? null;
  const latestSignature = latest ? signatures.find(signature => signature.anamnesis_version_id === latest.id) ?? null : null;
  const activeLink = latest ? links.find(link => link.anamnesis_version_id === latest.id && !link.revoked_at && !link.consumed_at && new Date(link.expires_at).getTime() > Date.now()) ?? null : null;
  const state = current?.status === 'draft' ? 'Draft' : latestSignature ? 'Assinada' : activeLink ? 'Aguardando assinatura' : latest ? 'Finalizada' : 'Sem anamnese';

  const generate = async (mode: Exclude<AnamnesisSignatureDeliveryMode, 'legacy'>) => {
    if (!latest || actionBusy) return;
    setActionBusy(true);
    setGeneratedLink(null);
    try {
      const result = await createAnamnesisSignatureLink(latest.id, mode);
      const next = { url: buildAnamnesisSignatureUrl(result.token), mode, expiresAt: result.expires_at } satisfies GeneratedLink;
      setGeneratedLink(next);
      toast.success(mode === 'in_person' ? 'Tela segura preparada para assinatura presencial.' : 'Link seguro preparado para envio.');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível preparar a assinatura.');
    } finally {
      setActionBusy(false);
    }
  };

  const copyGenerated = async () => {
    if (!generatedLink) return;
    try {
      await navigator.clipboard.writeText(generatedLink.url);
      toast.success('Link copiado.');
    } catch {
      toast.error('Não foi possível copiar automaticamente.');
    }
  };

  const shareGenerated = async () => {
    if (!generatedLink) return;
    if (!navigator.share) {
      await copyGenerated();
      return;
    }
    try {
      await navigator.share({
        title: 'Anamnese para assinatura',
        text: 'Olá! A clínica preparou sua anamnese para conferência e assinatura segura.',
        url: generatedLink.url,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      toast.error('Não foi possível abrir o compartilhamento. Você ainda pode copiar o link.');
    }
  };

  const openPatientScreen = () => {
    if (!generatedLink) return;
    const opened = window.open(generatedLink.url, '_blank', 'noopener,noreferrer');
    if (!opened) window.location.assign(generatedLink.url);
  };

  const revoke = async () => {
    if (!activeLink || actionBusy) return;
    const ok = await confirm({
      title: 'Revogar acesso à assinatura?',
      message: 'A paciente não poderá mais usar o acesso atual. Você poderá preparar um novo depois.',
      confirmLabel: 'Revogar',
      cancelLabel: 'Manter',
      tone: 'warning',
    });
    if (!ok) return;
    setActionBusy(true);
    try {
      await revokeAnamnesisSignatureLink(activeLink.id);
      setGeneratedLink(null);
      setSignatureModalOpen(false);
      toast.success('Acesso revogado.');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível revogar o acesso.');
    } finally {
      setActionBusy(false);
    }
  };

  const showLatestSignedVersion = () => {
    if (!latest) return;
    setSelectedVersionId(latest.id);
    window.setTimeout(() => document.getElementById('anamnesis-history')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  if (loading) return <div className="loading-state">Carregando...</div>;
  if (error) return <div className="empty-state"><p>{error}</p></div>;

  return <div style={{ padding: 18, display: 'grid', gap: 12 }}>
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}><FileCheck2 size={17} /><strong>Anamnese atual</strong><span className={`badge ${state === 'Assinada' ? 'badge--green' : state === 'Draft' ? 'badge--rose' : ''}`}>{state}</span></div>
          {latest ? <div className="page-sub" style={{ marginTop: 6 }}>Versão {latest.version_number} · concluída em {dateTime(latest.completed_at)}</div> : <div className="page-sub" style={{ marginTop: 6 }}>Nenhuma versão concluída.</div>}
          {current?.status === 'draft' && <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 13 }}><Clock3 size={14} /><strong>Anamnese pendente / rascunho</strong><span className="page-sub">· salva {dateTime(current.last_saved_at)}</span></div>}
          {latestSignature && <div className="anamnesis-signed-summary"><ShieldCheck size={15} /><div><strong>Assinatura concluída</strong><span>Versão {latest?.version_number} · {dateTime(latestSignature.signed_at)}</span></div></div>}
          {activeLink && <div className="anamnesis-signature-pending"><ShieldCheck size={14} /><div><strong>Assinatura aguardando</strong><span>{activeLink.delivery_mode === 'in_person' ? 'Acesso presencial' : 'Link remoto'} · válido até {dateTime(activeLink.expires_at)}. Por segurança, o endereço completo não é recuperado depois.</span></div></div>}
        </div>
        <button className="btn btn--primary btn--sm" type="button" onClick={() => navigate(`/pacientes/${patientId}/anamnese`)}><PencilLine size={15} />{current?.status === 'draft' ? 'Continuar' : latest ? 'Criar nova versão' : 'Preencher anamnese'}</button>
      </div>

      {latest && <div className="anamnesis-signature-toolbar">
        {latestSignature && <button className="btn btn--secondary btn--sm" type="button" onClick={showLatestSignedVersion}><FileCheck2 size={14} /> Ver versão assinada</button>}
        {!latestSignature && !activeLink && <button className="btn btn--secondary btn--sm" type="button" disabled={actionBusy} onClick={() => { setGeneratedLink(null); setSignatureModalOpen(true); }}><ShieldCheck size={14} /> Coletar assinatura</button>}
        {activeLink && <button className="btn btn--ghost btn--sm" type="button" disabled={actionBusy} onClick={() => void revoke()}><Unlink size={14} /> Revogar acesso</button>}
      </div>}
    </div>

    <div className="card" id="anamnesis-history" style={{ padding: 14, scrollMarginTop: 12 }}>
      <strong>Histórico</strong>
      {versions.length === 0 ? <p className="page-sub" style={{ marginTop: 8 }}>Nenhuma versão concluída ainda.</p> : <div style={{ display: 'grid', gap: 7, marginTop: 10 }}>{versions.map(version => {
        const open = selectedVersionId === version.id;
        const signed = signatures.some(signature => signature.anamnesis_version_id === version.id);
        return <div key={version.id} style={{ border: '1px solid var(--border)', borderRadius: 9, overflow: 'hidden' }}><button type="button" onClick={() => setSelectedVersionId(open ? null : version.id)} style={{ width: '100%', minHeight: 48, display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', border: 0, background: 'var(--bg-2)', color: 'var(--text)', textAlign: 'left', cursor: 'pointer' }}><div style={{ flex: 1 }}><strong>Versão {version.version_number}</strong><div className="page-sub">{dateTime(version.completed_at)}{version.migration_source === 'legacy' ? ' · legado preservado' : ''}{signed ? ' · assinada' : ''}</div></div>{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>{open && <div style={{ padding: '0 10px 10px' }}><HistoricalVersion version={version} /></div>}</div>;
      })}</div>}
    </div>

    <Modal open={signatureModalOpen} onClose={() => { if (!actionBusy) setSignatureModalOpen(false); }} title="Coletar assinatura da anamnese">
      {!generatedLink ? <div className="anamnesis-signature-modal">
        <div className="anamnesis-signature-modal__intro"><strong>Como a paciente vai assinar?</strong><p>Escolha o fluxo. Os dois usam a mesma versão congelada da anamnese.</p></div>
        <div className="anamnesis-signature-mode-grid">
          <button type="button" className="anamnesis-signature-mode" disabled={actionBusy} onClick={() => void generate('in_person')}><span className="anamnesis-signature-mode__icon"><Tablet size={24} /></span><span><strong>Assinar agora neste iPad</strong><small>A paciente está com você. Abre uma tela limpa para revisar e assinar.</small></span></button>
          <button type="button" className="anamnesis-signature-mode" disabled={actionBusy} onClick={() => void generate('remote')}><span className="anamnesis-signature-mode__icon"><Smartphone size={24} /></span><span><strong>Enviar para a paciente</strong><small>Gera um acesso remoto protegido por confirmação de identidade.</small></span></button>
        </div>
        {actionBusy && <div className="page-sub">Preparando acesso seguro…</div>}
      </div> : <div className="anamnesis-signature-modal">
        <div className="anamnesis-signature-ready"><CheckCircleIcon /><div><strong>{generatedLink.mode === 'in_person' ? 'Tela presencial pronta' : 'Link remoto pronto para enviar'}</strong><span>Válido até {dateTime(generatedLink.expiresAt)}.</span></div></div>
        {generatedLink.mode === 'in_person' ? <>
          <p className="page-sub">Abra a tela da paciente somente quando estiver pronta para entregar o iPad. Ela verá apenas a revisão e a assinatura.</p>
          <button className="btn btn--primary btn--md" type="button" onClick={openPatientScreen}><ExternalLink size={16} /> Abrir tela da paciente</button>
        </> : <>
          <p className="page-sub">O conteúdo clínico só é liberado depois que a paciente confirma um dado cadastrado na clínica.</p>
          <div className="anamnesis-signature-share-actions"><button className="btn btn--primary btn--md" type="button" onClick={() => void shareGenerated()}><Send size={16} /> Compartilhar</button><button className="btn btn--secondary btn--md" type="button" onClick={() => void copyGenerated()}><Copy size={16} /> Copiar link</button></div>
        </>}
        <small className="anamnesis-signature-once">Por segurança, este endereço completo é mostrado somente agora. Se ele for perdido, revogue o acesso e prepare outro.</small>
      </div>}
    </Modal>
  </div>;
}

function CheckCircleIcon() {
  return <span className="anamnesis-signature-ready__icon"><ShieldCheck size={19} /></span>;
}
