import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, RotateCcw, ShieldCheck } from 'lucide-react';
import SignatureCanvas from 'react-signature-canvas';
import { useParams } from 'react-router-dom';
import {
  signPublicAnamnesis,
  viewPublicAnamnesisSignature,
  type AnamnesisSignatureDeliveryMode,
  type AnamnesisSignatureVerificationMethod,
  type PublicAnamnesisSignaturePayload,
} from '../../lib/anamnesisSignature';
import './anamnesis-signature.css';

type SchemaField = { key?: string; label?: string; type?: string; detail_key?: string; options?: string[] };
type SchemaSection = { key?: string; title?: string; fields?: SchemaField[] };

function source(snapshot: Record<string, unknown>, section: string) {
  if (section === 'conditions') return (snapshot.conditions ?? {}) as Record<string, unknown>;
  if (['allergies', 'intolerances', 'medical_history', 'womens_health'].includes(section)) return (snapshot.surgical_history ?? {}) as Record<string, unknown>;
  if (['food', 'routine', 'habits'].includes(section)) return (snapshot.habits ?? {}) as Record<string, unknown>;
  if (['procedures', 'skin_review', 'aesthetics'].includes(section)) return (snapshot.aesthetics ?? {}) as Record<string, unknown>;
  return snapshot;
}

function display(snapshot: Record<string, unknown>, section: string, field: SchemaField) {
  const key = field.key ?? '';
  const area = source(snapshot, section);
  const value = area[key];
  if (field.type === 'status_text') {
    const statusKey = key === 'allergies' ? 'allergies_status' : 'medications_status';
    const status = snapshot[statusKey];
    if (status === 'none') return key === 'allergies' ? 'Não possui' : 'Não utiliza';
    if (status === 'reported') {
      const detail = String(snapshot[key] ?? '').trim();
      return detail ? `Sim — ${detail}` : 'Sim';
    }
    return 'Sem resposta registrada';
  }
  if (field.type === 'text_legacy') return String(snapshot[key] ?? '').trim() || 'Não informado no modelo legado';
  if (['boolean', 'boolean_detail', 'boolean_frequency', 'procedure_note'].includes(field.type ?? '')) {
    if (value === true) {
      const detail = field.detail_key ? String(area[field.detail_key] ?? '').trim() : '';
      return detail ? `Sim — ${detail}` : 'Sim';
    }
    if (value === false) {
      const detail = field.type === 'procedure_note' && field.detail_key ? String(area[field.detail_key] ?? '').trim() : '';
      return detail ? `Não — ${detail}` : 'Não';
    }
    return 'Sem resposta registrada';
  }
  if (value === null || value === undefined || value === '') return 'Não informado';
  return String(value);
}

function verificationCopy(method?: AnamnesisSignatureVerificationMethod) {
  if (method === 'phone_last4') {
    return {
      label: '4 últimos números do celular',
      help: 'Digite os 4 últimos números do telefone cadastrado na clínica.',
      inputMode: 'numeric' as const,
      type: 'text' as const,
      placeholder: '0000',
    };
  }
  return {
    label: 'Data de nascimento',
    help: 'Informe sua data de nascimento para acessar o conteúdo clínico.',
    inputMode: undefined,
    type: 'date' as const,
    placeholder: '',
  };
}

function successInstruction(mode?: AnamnesisSignatureDeliveryMode) {
  return mode === 'in_person'
    ? 'Pronto. Entregue o iPad à equipe da clínica.'
    : 'Pronto. Você já pode fechar esta página.';
}

export function AnamnesisSignaturePage() {
  const { token = '' } = useParams();
  const sigRef = useRef<SignatureCanvas>(null);
  const canvasBoxRef = useRef<HTMLDivElement>(null);
  const lock = useRef(false);
  const [payload, setPayload] = useState<PublicAnamnesisSignaturePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verificationValue, setVerificationValue] = useState('');
  const [reviewConfirmed, setReviewConfirmed] = useState(false);

  useEffect(() => {
    document.title = 'Assinatura de anamnese · Hub Giulia';
    const noCache = document.createElement('meta');
    noCache.httpEquiv = 'Cache-Control';
    noCache.content = 'no-store, no-cache, must-revalidate';
    document.head.appendChild(noCache);
    return () => noCache.remove();
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void viewPublicAnamnesisSignature(token)
      .then(data => {
        if (!active) return;
        setPayload(data);
        setError(null);
      })
      .catch(err => {
        if (active) setError(err instanceof Error ? err.message : 'Este link não está disponível.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (payload?.status !== 'pending') return;
    const box = canvasBoxRef.current;
    const signature = sigRef.current;
    if (!box || !signature) return;

    let frame = 0;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const canvas = signature.getCanvas();
        const rect = box.getBoundingClientRect();
        if (rect.width < 20 || rect.height < 20) return;
        const hadSignature = !signature.isEmpty();
        const data = hadSignature ? signature.toDataURL('image/png') : null;
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        canvas.width = Math.floor(rect.width * ratio);
        canvas.height = Math.floor(rect.height * ratio);
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
        canvas.getContext('2d')?.scale(ratio, ratio);
        signature.clear();
        if (data) signature.fromDataURL(data, { ratio, width: rect.width, height: rect.height });
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(box);
    resize();
    window.addEventListener('orientationchange', resize);
    return () => {
      observer.disconnect();
      window.removeEventListener('orientationchange', resize);
      cancelAnimationFrame(frame);
    };
  }, [payload?.status]);

  const verify = async () => {
    if (!verificationValue.trim() || verifying) return;
    setVerifying(true);
    setError(null);
    try {
      const data = await viewPublicAnamnesisSignature(token, verificationValue.trim());
      setPayload(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível confirmar seus dados.');
    } finally {
      setVerifying(false);
    }
  };

  const submit = async () => {
    if (lock.current || signing || !payload || payload.status !== 'pending') return;
    if (!reviewConfirmed) {
      setError('Confirme que você revisou as informações antes de assinar.');
      return;
    }
    if (!sigRef.current || sigRef.current.isEmpty()) {
      setError('Faça a assinatura no campo abaixo antes de confirmar.');
      return;
    }
    lock.current = true;
    setSigning(true);
    setError(null);
    try {
      const result = await signPublicAnamnesis(token, sigRef.current.toDataURL('image/png'), verificationValue.trim() || undefined);
      setPayload({ status: 'signed', signed_at: result.signed_at, delivery_mode: payload.delivery_mode });
    } catch (err) {
      lock.current = false;
      setError(err instanceof Error ? err.message : 'Não foi possível concluir a assinatura.');
    } finally {
      setSigning(false);
    }
  };

  const sections = useMemo(
    () => ((payload?.form_schema_snapshot?.sections ?? []) as SchemaSection[]).filter(section => Array.isArray(section.fields)),
    [payload?.form_schema_snapshot],
  );
  const snapshot = payload?.answers_snapshot ?? {};

  if (loading) return <main className="public-anamnesis-sign"><div className="public-sign-card">Preparando sua anamnese…</div></main>;
  if (error && !payload) return <main className="public-anamnesis-sign"><div className="public-sign-card public-sign-error"><ShieldCheck size={30} /><h1>Link indisponível</h1><p>{error}</p><small>Solicite um novo link à clínica se necessário.</small></div></main>;
  if (payload?.status === 'signed') return <main className="public-anamnesis-sign"><div className="public-sign-card public-sign-success"><CheckCircle2 size={46} /><h1>Assinatura concluída</h1><p>A versão revisada da sua anamnese foi registrada com segurança.</p>{payload.signed_at && <strong>{new Date(payload.signed_at).toLocaleString('pt-BR')}</strong>}<small>{successInstruction(payload.delivery_mode)}</small></div></main>;

  if (payload?.status === 'verification_required') {
    const copy = verificationCopy(payload.verification_method);
    return <main className="public-anamnesis-sign"><div className="public-sign-card public-sign-verify"><ShieldCheck size={38} /><div className="public-sign-eyebrow">Proteção dos seus dados</div><h1>Confirme que é você</h1><p>{copy.help}</p><label className="public-sign-verify-field"><span>{copy.label}</span><input type={copy.type} inputMode={copy.inputMode} maxLength={payload.verification_method === 'phone_last4' ? 4 : undefined} autoComplete="off" value={verificationValue} placeholder={copy.placeholder} onChange={event => setVerificationValue(payload.verification_method === 'phone_last4' ? event.target.value.replace(/\D/g, '').slice(0, 4) : event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void verify(); }} /></label>{error && <div className="public-sign-inline-error" role="alert">{error}</div>}<button className="btn btn--primary btn--md public-sign-confirm" type="button" disabled={verifying || !verificationValue.trim()} onClick={() => void verify()}>{verifying ? 'Confirmando…' : 'Continuar para revisar'}</button><small>Essa confirmação é usada somente para liberar esta versão da anamnese.</small></div></main>;
  }

  return <main className="public-anamnesis-sign"><div className="public-sign-shell">
    <header className="public-sign-header"><div><div className="public-sign-eyebrow">Clínica Dra. Giulia Assis</div><h1>Revise e assine sua anamnese</h1><p>{payload?.patient_name} · versão {payload?.version_number}</p></div><span className="public-sign-badge"><ShieldCheck size={14} /> Conteúdo congelado</span></header>

    <div className="public-sign-workspace">
      <section className="public-sign-document" aria-label="Conteúdo da anamnese">
        <div className="public-sign-intro"><strong>Confira suas informações</strong><p>Leia o conteúdo abaixo e confirme se ele representa corretamente o que foi informado à clínica.</p></div>
        <nav className="public-sign-section-nav" aria-label="Ir para seção">{sections.map((section, index) => <button type="button" key={`${section.key ?? index}`} onClick={() => document.getElementById(`public-section-${section.key ?? index}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{section.title ?? 'Seção'}</button>)}</nav>
        {sections.map((section, index) => <article id={`public-section-${section.key ?? index}`} key={`${section.key ?? index}`}><h2>{section.title ?? 'Seção'}</h2>{(section.fields ?? []).map((field, i) => <div className="public-sign-row" key={`${field.key ?? i}`}><span>{field.label ?? field.key}</span><strong>{display(snapshot, section.key ?? '', field)}</strong></div>)}</article>)}
        <div className="public-sign-integrity">Identificador de integridade: {payload?.content_sha256?.slice(0, 16)}…</div>
      </section>

      <aside className="public-sign-action" aria-label="Assinatura da paciente">
        <div><div className="public-sign-step">Última etapa</div><h2>Assinatura da paciente</h2><p>Depois de revisar, confirme e assine com o dedo, Apple Pencil ou mouse.</p></div>
        <label className="public-sign-review-check"><input type="checkbox" checked={reviewConfirmed} onChange={event => { setReviewConfirmed(event.target.checked); setError(null); }} /><span><strong>Li e conferi as informações acima.</strong><small>Confirmo que as informações apresentadas estão corretas de acordo com o que informei à clínica.</small></span></label>
        <div ref={canvasBoxRef} className="public-sign-canvas"><SignatureCanvas ref={sigRef} backgroundColor="white" penColor="#1a1a2e" canvasProps={{ 'aria-label': 'Área de assinatura', className: 'public-sign-canvas-el' }} /></div>
        <button className="btn btn--ghost btn--md" type="button" disabled={signing} onClick={() => { sigRef.current?.clear(); setError(null); }}><RotateCcw size={15} /> Refazer assinatura</button>
        {error && <div className="public-sign-inline-error" role="alert">{error}</div>}
        <button className="btn btn--primary btn--md public-sign-confirm" type="button" disabled={signing} onClick={() => void submit()}>{signing ? 'Registrando assinatura…' : 'Assinar e concluir'}</button>
        <small>Ao concluir, sua assinatura fica vinculada somente à versão exibida acima. Alterações futuras exigem uma nova versão.</small>
      </aside>
    </div>
  </div></main>;
}
