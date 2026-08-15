import { useEffect, useMemo, useState } from 'react';
import { Camera, Plus, Save, Trash2 } from 'lucide-react';
import { Skeleton } from '../../components/ui/Skeleton';
import { useDirtyFormGuard } from '../../hooks/useDirtyFormGuard';
import { useServicos } from '../../hooks/useServicos';
import { useToast } from '../../hooks/useToast';
import { emptyServiceAftercareProtocol, normalizeServiceAftercareProtocol, validateAftercareSteps, type ServiceAftercareProtocol, type ServiceAftercareStep } from '../../hooks/useAftercare';
import { supabase } from '../../lib/supabase';

const canonical = (value: ServiceAftercareProtocol) => JSON.stringify({
  name: value.name.trim(),
  enabled: value.enabled,
  instructions: value.instructions.trim(),
  photo_followup: value.photo_followup,
  steps: value.steps.map(({ offset_days, label }, index) => ({ offset_days, label: label?.trim() || null, sort_order: index })),
});

export function ServiceAftercareSettings() {
  const { servicos, loading: servicesLoading, error: servicesError } = useServicos();
  const { toast } = useToast();
  const [serviceId, setServiceId] = useState('');
  const [draft, setDraft] = useState<ServiceAftercareProtocol | null>(null);
  const [baseline, setBaseline] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(() => servicos.find(service => service.id === serviceId) ?? null, [serviceId, servicos]);
  const dirty = Boolean(draft && baseline && canonical(draft) !== baseline);
  useDirtyFormGuard('service-aftercare-protocol', dirty);

  useEffect(() => {
    if (!serviceId && servicos.length > 0) setServiceId(servicos[0].id);
  }, [serviceId, servicos]);

  useEffect(() => {
    let alive = true;
    if (!serviceId) { setDraft(null); setBaseline(''); return; }
    setLoading(true); setError(null);
    void supabase.rpc('get_service_aftercare_protocol_v1', { p_service_id: serviceId }).then(({ data, error: rpcError }) => {
      if (!alive) return;
      if (rpcError) {
        setDraft(null); setBaseline(''); setError(rpcError.message);
      } else {
        const next = normalizeServiceAftercareProtocol(serviceId, data);
        setDraft(next); setBaseline(canonical(next));
      }
      setLoading(false);
    });
    return () => { alive = false; };
  }, [serviceId]);

  const set = <K extends keyof ServiceAftercareProtocol>(key: K, value: ServiceAftercareProtocol[K]) => setDraft(current => current ? { ...current, [key]: value } : current);
  const setStep = (index: number, patch: Partial<ServiceAftercareStep>) => setDraft(current => current ? { ...current, steps: current.steps.map((step, itemIndex) => itemIndex === index ? { ...step, ...patch } : step) } : current);
  const addStep = () => setDraft(current => current ? { ...current, steps: [...current.steps, { offset_days: Number.NaN, label: null }] } : current);
  const removeStep = (index: number) => setDraft(current => current ? { ...current, steps: current.steps.filter((_, itemIndex) => itemIndex !== index) } : current);

  const save = async () => {
    if (!draft || !selected || saving) return;
    const validation = validateAftercareSteps(draft.steps);
    if (validation) { toast.error(validation); return; }
    if (draft.instructions.length > 12000) { toast.error('As orientações devem ter no máximo 12.000 caracteres.'); return; }
    if (draft.enabled && !draft.instructions.trim() && draft.steps.length === 0 && !draft.photo_followup) {
      toast.error('Ative pelo menos uma orientação, check-in ou lembrete de fotos.'); return;
    }
    setSaving(true); setError(null);
    const { data, error: rpcError } = await supabase.rpc('save_service_aftercare_protocol_v1', {
      p_service_id: selected.id,
      p_enabled: draft.enabled,
      p_instructions: draft.instructions.trim() || null,
      p_photo_followup: draft.photo_followup,
      p_steps: draft.steps.map((step, index) => ({ offset_days: step.offset_days, label: step.label?.trim() || null, sort_order: index })),
      p_name: draft.name.trim() || 'Pós-atendimento',
    });
    if (rpcError) {
      setError(rpcError.message); toast.error('Não foi possível salvar o pós-atendimento.');
    } else {
      const saved = { ...draft, id: String((data as { id?: string } | null)?.id ?? draft.id ?? ''), version: Number((data as { version?: number } | null)?.version ?? draft.version + 1) };
      setDraft(saved); setBaseline(canonical(saved)); toast.success('Protocolo pós-atendimento salvo. Procedimentos futuros usarão esta versão.');
    }
    setSaving(false);
  };

  if (servicesLoading) return <div className="card" style={{ padding: 16 }}><Skeleton lines={5} /></div>;
  if (servicesError) return <div className="empty-state"><p>{servicesError}</p></div>;
  if (servicos.length === 0) return <div className="card" style={{ padding: 16 }}><p className="page-sub">Cadastre um serviço antes de configurar pós-atendimento.</p></div>;

  return <section className="card" style={{ padding: 16, display: 'grid', gap: 14 }} aria-labelledby="aftercare-settings-title">
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div><h2 id="aftercare-settings-title" style={{ margin: 0, fontSize: 16 }}>Pós-atendimento</h2><p className="page-sub" style={{ marginTop: 4 }}>A profissional define a rotina. O Hub apenas prepara, lembra e registra — sem decidir conduta clínica.</p></div>
      {draft?.version ? <span className="badge">Versão {draft.version}</span> : null}
    </div>

    <label style={{ display: 'grid', gap: 5, maxWidth: 520 }}><span className="field-label">Serviço</span><select className="field-input" value={serviceId} onChange={event => setServiceId(event.target.value)} disabled={dirty || saving}>{servicos.map(service => <option key={service.id} value={service.id}>{service.name}{service.active ? '' : ' · inativo'}</option>)}</select>{dirty && <span className="page-sub">Salve ou descarte as alterações antes de trocar de serviço.</span>}</label>

    {loading || !draft ? <Skeleton lines={6} /> : <>
      {error && <div className="communication-error" role="alert">{error}</div>}
      <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 700 }}><input type="checkbox" checked={draft.enabled} onChange={event => set('enabled', event.target.checked)} /> Ativar acompanhamento pós-procedimento</label>

      <label style={{ display: 'grid', gap: 5 }}><span className="field-label">Orientações pós-procedimento</span><textarea className="field-input" rows={7} value={draft.instructions} onChange={event => set('instructions', event.target.value)} placeholder="Escreva aqui somente as orientações definidas pela profissional." /><span className="page-sub">Este texto será congelado no plano do procedimento. Alterações futuras não modificam o histórico.</span></label>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'grid', gap: 9 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}><div><strong style={{ fontSize: 13 }}>Check-ins</strong><div className="page-sub">Cada linha significa “entrar em contato”, não “retorno clínico”.</div></div><button type="button" className="btn btn--secondary btn--sm" onClick={addStep} disabled={draft.steps.length >= 20}><Plus size={14} /> Adicionar</button></div>
        {draft.steps.length === 0 ? <div style={{ padding: 11, border: '1px dashed var(--border)', borderRadius: 10 }} className="page-sub">Nenhum check-in configurado.</div> : draft.steps.map((step, index) => <div key={step.id ?? `new-${index}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(130px,180px) minmax(180px,1fr) auto', gap: 8, alignItems: 'end' }}>
          <label style={{ display: 'grid', gap: 4 }}><span className="page-sub">Dias depois</span><input className="field-input" type="number" min={0} max={3650} step={1} value={Number.isFinite(step.offset_days) ? step.offset_days : ''} onChange={event => setStep(index, { offset_days: event.target.value === '' ? Number.NaN : Number(event.target.value) })} placeholder="Ex.: 2" /></label>
          <label style={{ display: 'grid', gap: 4 }}><span className="page-sub">Nome opcional</span><input className="field-input" value={step.label ?? ''} onChange={event => setStep(index, { label: event.target.value || null })} placeholder="Ex.: Check-in 48h" /></label>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => removeStep(index)} aria-label="Remover check-in"><Trash2 size={15} /></button>
        </div>)}
      </div>

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, borderTop: '1px solid var(--border)', paddingTop: 12 }}><input type="checkbox" checked={draft.photo_followup} onChange={event => set('photo_followup', event.target.checked)} /><span><strong style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}><Camera size={15} /> Lembrar fotos no acompanhamento</strong><span className="page-sub" style={{ display: 'block', marginTop: 2 }}>Não cria sessão nem pede foto à paciente. Photos 2.0 continua sendo usado pela profissional quando ela voltar à clínica.</span></span></label>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}><strong style={{ fontSize: 13 }}>Retorno clínico</strong><p className="page-sub" style={{ margin: '4px 0 0' }}>Continua 100% no Returns 2.0 e na configuração canônica de retorno acima. O pós-atendimento não guarda uma segunda data de retorno.</p></div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}><button type="button" className="btn btn--ghost btn--md" disabled={!dirty || saving} onClick={() => { const next = emptyServiceAftercareProtocol(serviceId); void supabase.rpc('get_service_aftercare_protocol_v1', { p_service_id: serviceId }).then(({ data }) => { const restored = normalizeServiceAftercareProtocol(serviceId, data ?? next); setDraft(restored); setBaseline(canonical(restored)); }); }}>Descartar</button><button type="button" className="btn btn--primary btn--md" disabled={!dirty || saving} onClick={() => void save()}><Save size={16} /> {saving ? 'Salvando…' : 'Salvar pós-atendimento'}</button></div>
    </>}
  </section>;
}
