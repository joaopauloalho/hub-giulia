import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ArrowLeft, Camera, Check, Clock3, Loader2, MapPin } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { POSTGREST_SELECT } from '../../lib/postgrestRelationshipHints';
import { clearAttendanceInjectableDraft, clearAttendanceInjectablePoints } from '../../lib/attendanceRuntime';
import { usePacientes } from '../../hooks/usePacientes';
import { useServicos } from '../../hooks/useServicos';
import { useProcedures } from '../../hooks/useProcedures';
import { useInjetaveis } from '../../hooks/useInjetaveis';
import { useToast } from '../../hooks/useToast';
import type { InjectablePoint, Patient, Procedure, ProcedureItem, Service } from '../../types';
import { MaterialsStep, type SelectedAttendanceMaterial } from './MaterialsStep';

const InjetaveisScreen = lazy(() => import('./InjetaveisScreen').then(module => ({ default: module.InjetaveisScreen })));
const TODAY = format(new Date(), 'yyyy-MM-dd');

type ParentProcedure = Procedure & {
  attendance_type?: 'procedure' | 'return';
  parent_procedure_id?: string | null;
};

function clinicalTimeLabel(minutes: number) {
  if (!minutes) return 'Sem tempo informado';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours}h${String(rest).padStart(2, '0')}` : `${hours}h`;
}

export function ReturnRegistrarPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const parentId = searchParams.get('return_of');
  const { getById } = usePacientes();
  const { servicos, loading: loadingServices } = useServicos();
  const { create } = useProcedures();
  const { save: saveInjectables } = useInjetaveis();
  const { toast } = useToast();

  const [parent, setParent] = useState<ParentProcedure | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [performedDate, setPerformedDate] = useState(TODAY);
  const [notes, setNotes] = useState('');
  const [clinicalMinutes, setClinicalMinutes] = useState(0);
  const [materials, setMaterials] = useState<SelectedAttendanceMaterial[]>([]);
  const [injectablePoints, setInjectablePoints] = useState<InjectablePoint[]>([]);
  const [injectablesOpen, setInjectablesOpen] = useState(false);
  const [injectablesDone, setInjectablesDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [doneProcedureId, setDoneProcedureId] = useState<string | null>(null);

  useEffect(() => {
    if (!parentId) { setLoading(false); return; }
    let active = true;
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('procedures')
          .select(POSTGREST_SELECT.patientProcedures)
          .eq('id', parentId)
          .single();
        if (error) throw error;
        if (!active) return;
        const row = {
          ...data,
          items: data.procedure_items ?? [],
          payments: data.procedure_payments ?? [],
        } as unknown as ParentProcedure;
        const canonicalParentId = row.attendance_type === 'return' && row.parent_procedure_id ? row.parent_procedure_id : row.id;
        if (canonicalParentId !== row.id) {
          const { data: original, error: originalError } = await supabase
            .from('procedures')
            .select(POSTGREST_SELECT.patientProcedures)
            .eq('id', canonicalParentId)
            .single();
          if (originalError) throw originalError;
          if (!active) return;
          setParent({ ...original, items: original.procedure_items ?? [], payments: original.procedure_payments ?? [] } as unknown as ParentProcedure);
          setSelectedServiceIds(((original.procedure_items ?? []) as ProcedureItem[]).map(item => item.service_id));
          const loadedPatient = await getById(original.patient_id);
          if (active) setPatient(loadedPatient);
        } else {
          setParent(row);
          setSelectedServiceIds((row.items ?? []).map(item => item.service_id));
          const loadedPatient = await getById(row.patient_id);
          if (active) setPatient(loadedPatient);
        }
      } catch (error) {
        console.error('[return-registrar:load]', error);
        if (active) toast.error('Não foi possível abrir o atendimento original.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [getById, parentId, toast]);

  useEffect(() => () => {
    clearAttendanceInjectableDraft();
    clearAttendanceInjectablePoints();
  }, []);

  const originalServices = useMemo(() => {
    const ids = new Set((parent?.items ?? []).map(item => item.service_id));
    return servicos.filter(service => ids.has(service.id));
  }, [parent, servicos]);
  const selectedServices = useMemo(() => originalServices.filter(service => selectedServiceIds.includes(service.id)), [originalServices, selectedServiceIds]);
  const injectableServices = selectedServices.filter(service => service.is_injectable);
  const hasInjectables = injectableServices.length > 0;

  const toggleService = (service: Service) => {
    setSelectedServiceIds(current => current.includes(service.id) ? current.filter(id => id !== service.id) : [...current, service.id]);
    setInjectablesDone(false);
    setInjectablePoints([]);
    clearAttendanceInjectableDraft();
    clearAttendanceInjectablePoints();
  };

  const save = async () => {
    if (!parent || !patient || !selectedServices.length || performedDate > TODAY) return;
    setSaving(true);
    try {
      const procedure = await create({
        patient_id: patient.id,
        parent_procedure_id: parent.id,
        appointment_id: null,
        performed_at: new Date(`${performedDate}T12:00:00`).toISOString(),
        services_ids: selectedServices.map(service => service.id),
        total_value: 0,
        total_cost: selectedServices.reduce((sum, service) => sum + Number(service.cost_per_unit || 0), 0),
        payment_method: 'pix',
        card_fee_pct: null,
        card_fee_value: null,
        net_value: 0,
        notes: notes.trim() || null,
        payment_entries: [],
        coverage_entries: [],
        material_entries: materials.map(item => ({ material_id: item.material_id, quantity: item.quantity })),
        item_values: selectedServices.map(service => ({ service_id: service.id, qty: 1, final_price: 0 })),
        clinical_minutes: clinicalMinutes,
      });
      if (injectablePoints.length) await saveInjectables(patient.id, injectablePoints, procedure.id);
      setDoneProcedureId(procedure.id);
      toast.success('Retorno registrado sem nova cobrança.');
    } catch (error) {
      console.error('[return-registrar:create]', error);
      const message = error instanceof Error ? error.message : '';
      if (message.includes('MATERIAL_INSUFFICIENT_STOCK')) toast.error('Estoque insuficiente para um dos materiais.');
      else toast.error('Não foi possível registrar o retorno.');
    } finally {
      setSaving(false);
    }
  };

  if (loading || loadingServices) return <div className="page"><div className="full-loader"><Loader2 className="spin" size={24}/> Carregando retorno…</div></div>;
  if (!parentId || !parent || !patient) return <div className="page"><div className="empty-state" style={{ padding: 48 }}><p>Atendimento original não encontrado.</p><button className="btn btn--secondary btn--md" onClick={() => navigate('/pacientes')}>Voltar</button></div></div>;

  if (doneProcedureId) return <div className="page"><div style={{ minHeight: '62vh', display: 'grid', placeItems: 'center', padding: 30 }}><div style={{ maxWidth: 560, textAlign: 'center' }}><div style={{ width: 68, height: 68, margin: '0 auto 14px', borderRadius: '50%', background: '#dcfce7', color: '#166534', display: 'grid', placeItems: 'center' }}><Check size={34}/></div><h2>Retorno registrado</h2><p className="page-sub">{patient.name} · sem nova cobrança</p><div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 18, flexWrap: 'wrap' }}><button className="btn btn--secondary btn--md" onClick={() => navigate(`/pacientes/${patient.id}`)}><ArrowLeft size={16}/> Voltar à paciente</button><button className="btn btn--ghost btn--md" onClick={() => navigate(`/pacientes/${patient.id}?tab=fotos`)}><Camera size={16}/> Fotos</button><button className="btn btn--ghost btn--md" onClick={() => navigate(`/pacientes/${patient.id}?tab=injetaveis`)}><MapPin size={16}/> Injetáveis</button></div></div></div></div>;

  if (injectablesOpen) return <div className="page"><Suspense fallback={<div className="full-loader">Carregando mapa…</div>}><InjetaveisScreen patientId={patient.id} injectableServices={injectableServices} onDone={points => { setInjectablePoints(points); setInjectablesDone(true); setInjectablesOpen(false); }} onCancel={() => setInjectablesOpen(false)} onSkip={() => { setInjectablePoints([]); setInjectablesDone(true); setInjectablesOpen(false); }}/></Suspense></div>;

  return <div className="page">
    <div className="page-header"><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><button type="button" className="icon-btn" onClick={() => navigate(`/pacientes/${patient.id}`)} aria-label="Voltar"><ArrowLeft size={20}/></button><div><h1 className="page-title">Registrar retorno</h1><p className="page-sub">{patient.name}</p></div></div><span className="badge badge--green">Sem cobrança</span></div>

    <div style={{ maxWidth: 820, margin: '0 auto', padding: '0 16px 32px', display: 'grid', gap: 14 }}>
      <section className="card" style={{ padding: 16 }}>
        <strong>Referente ao atendimento de {new Date(parent.performed_at).toLocaleDateString('pt-BR')}</strong>
        <div className="page-sub" style={{ marginTop: 4 }}>{(parent.items ?? []).map(item => item.name).join(' · ')}</div>
        <div style={{ marginTop: 10, padding: 10, borderRadius: 9, background: '#f0fdf4', color: '#166534', fontSize: 13 }}><strong>Retorno clínico.</strong> O atendimento original e o pagamento permanecem intactos. Produto, material e tempo usados aqui entram apenas como custo deste retorno.</div>
      </section>

      <section className="card" style={{ padding: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
          <div><label className="field-label">Data do retorno</label><input className="field-input" type="date" max={TODAY} value={performedDate} onChange={event => setPerformedDate(event.target.value)}/></div>
          <div><label className="field-label">Tempo clínico</label><div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>{[0, 15, 20, 30, 45, 60].map(value => <button key={value} type="button" className={`btn btn--sm ${clinicalMinutes === value ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setClinicalMinutes(value)}>{value === 0 ? 'Não informar' : `${value} min`}</button>)}</div><small className="page-sub"><Clock3 size={11}/> {clinicalTimeLabel(clinicalMinutes)}</small></div>
        </div>
        <div style={{ marginTop: 12 }}><label className="field-label">Resumo / observações do retorno</label><textarea className="field-input" rows={3} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Ex.: reavaliação, movimento residual, anestesia, intercorrências, orientação…"/></div>
      </section>

      <section className="card" style={{ padding: 16 }}>
        <strong style={{ display: 'block', marginBottom: 4 }}>O que foi revisto neste retorno?</strong><span className="page-sub">Vêm somente os procedimentos do atendimento original. Desmarque o que não entrou no retorno.</span>
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>{originalServices.map(service => <button key={service.id} type="button" onClick={() => toggleService(service)} style={{ minHeight: 50, padding: '10px 12px', borderRadius: 11, border: `1px solid ${selectedServiceIds.includes(service.id) ? 'var(--primary)' : 'var(--border)'}`, background: selectedServiceIds.includes(service.id) ? 'var(--bg-2)' : 'var(--bg)', color: 'inherit', display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left' }}><span><strong>{service.name}</strong>{service.is_injectable && <small className="page-sub" style={{ display: 'block' }}>Permite novo mapa de injetáveis</small>}</span><strong style={{ color: '#166534' }}>R$ 0,00</strong></button>)}</div>
      </section>

      {hasInjectables && <section className="card" style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}><div><strong>Novo mapa de injetáveis</strong><div className="page-sub">Começa vazio. Registre novamente pontos, quantidade, lote, validade, etiqueta e resumo.</div></div><button type="button" className={`btn btn--md ${injectablesDone ? 'btn--secondary' : 'btn--primary'}`} onClick={() => setInjectablesOpen(true)}><MapPin size={16}/> {injectablesDone ? 'Editar mapa do retorno' : 'Registrar mapa do retorno'}</button></section>}

      <section className="card" style={{ padding: 16 }}><MaterialsStep selected={materials} onChange={setMaterials}/></section>

      <section className="card" style={{ padding: 16 }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}><div><strong>Financeiro</strong><div className="page-sub">Retorno vinculado ao atendimento original.</div></div><div style={{ textAlign: 'right' }}><strong style={{ color: '#166534' }}>R$ 0,00</strong><div className="page-sub">sem nova cobrança</div></div></div></section>

      <button type="button" className="btn-primary" style={{ minHeight: 52, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, opacity: selectedServices.length ? 1 : .45 }} disabled={saving || !selectedServices.length} onClick={() => void save()}>{saving ? <Loader2 className="spin" size={18}/> : <Check size={18}/>} {saving ? 'Registrando…' : 'Registrar retorno'}</button>
    </div>
  </div>;
}
