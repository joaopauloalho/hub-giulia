import { lazy, Suspense, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, CalendarPlus, ClipboardPlus, Mail, MessageCircle, Pencil, Phone, RotateCcw, StickyNote, TrendingUp, X } from 'lucide-react';
import type { Patient } from '../../types';
import { ageLabel } from '../../lib/dateUtils';
import { buildWhatsAppUrl } from '../../lib/whatsapp';
import { CRM_STAGE_LABEL } from '../../lib/crm';
import { getCrmPatientSummary, type CrmPipelineCard } from '../../hooks/useCrm';
import { useToast } from '../../hooks/useToast';
import { OverviewTab } from './tabs/OverviewTab';

const DadosTab = lazy(() => import('./tabs/DadosTab').then(module => ({ default: module.DadosTab })));
const AnamneseTab = lazy(() => import('./tabs/AnamneseTab').then(module => ({ default: module.AnamneseTab })));
const FotosTab = lazy(() => import('./tabs/FotosTab').then(module => ({ default: module.FotosTab })));
const HistoricoTab = lazy(() => import('./tabs/HistoricoTab').then(module => ({ default: module.HistoricoTab })));
const InjetaveisTab = lazy(() => import('./tabs/InjetaveisTab').then(module => ({ default: module.InjetaveisTab })));
const ContratosTab = lazy(() => import('./tabs/ContratosTab').then(module => ({ default: module.ContratosTab })));
const NotasTab = lazy(() => import('./tabs/NotasTab').then(module => ({ default: module.NotasTab })));
const TimelineTab = lazy(() => import('./tabs/TimelineTab').then(module => ({ default: module.TimelineTab })));
const FinanceiroPacienteTab = lazy(() => import('./tabs/FinanceiroPacienteTab').then(module => ({ default: module.FinanceiroPacienteTab })));
const SignatureScreen = lazy(() => import('./SignatureScreen').then(module => ({ default: module.SignatureScreen })));

interface Props {
  patient: Patient;
  archived?: boolean;
  sourceAppointmentId?: string | null;
  initialTab?: TabKey;
  onClose: () => void;
  onUpdate: (data: Partial<Patient>) => Promise<void>;
  onArchive: () => Promise<void>;
  onRestore: () => Promise<void>;
}

const TABS = [
  ['Visão geral', 'overview'],
  ['Histórico 360', 'timeline'],
  ['Atendimentos', 'procedures'],
  ['Anamnese', 'anamnesis'],
  ['Fotos', 'photos'],
  ['Injetáveis', 'injectables'],
  ['Financeiro', 'finance'],
  ['Contratos', 'contracts'],
  ['Notas', 'notes'],
  ['Dados', 'data'],
] as const;
export type TabKey = typeof TABS[number][1];

type SignatureRequest = {
  contractId?: string;
  procedureId?: string;
  appointmentId?: string;
};

const initials = (name: string) => name.split(' ').slice(0, 2).map(word => word[0]).join('').toUpperCase();

export function PacienteView({ patient, archived = false, sourceAppointmentId, initialTab, onClose, onUpdate, onArchive, onRestore }: Props) {
  const navigate = useNavigate();
  const { confirm, toast } = useToast();
  const [tab, setTab] = useState<TabKey>(initialTab ?? 'overview');
  const [signatureRequest, setSignatureRequest] = useState<SignatureRequest | null>(null);
  const [crmSummary, setCrmSummary] = useState<CrmPipelineCard | null>(null);

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    let alive = true;
    void getCrmPatientSummary(patient.id)
      .then(summary => { if (alive) setCrmSummary(summary); })
      .catch(error => console.warn('[patient360:crm-summary]', error));
    return () => { alive = false; };
  }, [patient.id]);

  const schedule = () => navigate(`/agenda?patient_id=${patient.id}`, { state: { patient: { id: patient.id, name: patient.name, phone: patient.phone }, from: '/pacientes' } });
  const crmOpportunity = () => navigate(`/crm?patient_id=${patient.id}`);
  const register = () => {
    const query = new URLSearchParams({ patient_id: patient.id });
    if (sourceAppointmentId) query.set('appointment_id', sourceAppointmentId);
    navigate(`/registrar?${query.toString()}`, { state: { patient, patientId: patient.id, appointmentId: sourceAppointmentId, from: '/pacientes' } });
  };
  const whatsapp = () => {
    if (!patient.phone) return;
    window.open(buildWhatsAppUrl(patient.phone, `Olá ${patient.name}!`), '_blank', 'noopener,noreferrer');
  };

  const archiveOrRestore = async () => {
    const ok = await confirm({
      title: archived ? 'Restaurar paciente' : 'Arquivar paciente',
      message: archived ? `Restaurar ${patient.name} para a lista ativa?` : `Arquivar ${patient.name}? O histórico clínico e financeiro será preservado e poderá ser restaurado.`,
      confirmLabel: archived ? 'Restaurar' : 'Arquivar',
      cancelLabel: 'Cancelar',
      tone: 'warning',
    });
    if (!ok) return;
    try {
      if (archived) await onRestore(); else await onArchive();
      toast.success(archived ? 'Paciente restaurada.' : 'Paciente arquivada.');
    } catch (err) {
      console.error('[patient360:archive]', err);
      toast.error('Não foi possível atualizar o arquivamento.');
    }
  };

  const openTimelineEvent = (eventType: string) => {
    if (eventType === 'appointment') { navigate('/agenda'); return; }
    if (eventType === 'return') { navigate(`/retornos?patient_id=${patient.id}`); return; }
    if (eventType === 'procedure') setTab('procedures');
    if (eventType === 'photo') setTab('photos');
    if (eventType === 'note') setTab('notes');
    if (eventType === 'contract') setTab('contracts');
    if (eventType === 'anamnesis') setTab('anamnesis');
    if (eventType === 'injectable') setTab('injectables');
  };

  if (signatureRequest) {
    return <Suspense fallback={<div className="full-loader">Carregando assinatura...</div>}>
      <SignatureScreen
        patient={patient}
        contractId={signatureRequest.contractId ?? null}
        initialProcedureId={signatureRequest.procedureId ?? null}
        initialAppointmentId={signatureRequest.appointmentId ?? null}
        onClose={() => setSignatureRequest(null)}
        onDone={() => { setSignatureRequest(null); setTab('contracts'); }}
      />
    </Suspense>;
  }

  return <div className="drawer-overlay" onClick={onClose}>
    <aside className="drawer" style={{ width: 'min(980px, 100vw)' }} role="dialog" aria-modal="true" aria-labelledby="paciente-view-title" onClick={event => event.stopPropagation()}>
      <div className="drawer-header">
        <button className="drawer-back" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        <div className="avatar">{initials(patient.name)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="drawer-title" id="paciente-view-title">{patient.name}{archived && <span className="badge badge--amber" style={{ marginLeft: 8 }}>Arquivada</span>}</div>
          <div className="drawer-sub" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 2 }}>
            {ageLabel(patient.birth_date) && <span>{ageLabel(patient.birth_date)}</span>}
            {patient.phone && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Phone size={11} />{patient.phone}</span>}
            {patient.email && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Mail size={11} />{patient.email}</span>}
            {crmSummary && <button type="button" className="badge badge--rose" style={{ border: 0, cursor: 'pointer' }} onClick={() => navigate('/crm')}><TrendingUp size={11} style={{ marginRight: 4 }} />CRM · {CRM_STAGE_LABEL[crmSummary.stage]}{crmSummary.next_followup_on ? ` · follow-up ${crmSummary.next_followup_on.split('-').reverse().join('/')}` : ''}</button>}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 7, padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg-2)', overflowX: 'auto', flexShrink: 0 }}>
        <button className="btn btn--primary btn--sm" onClick={schedule}><CalendarPlus size={15} /> Agendar</button>
        <button className="btn btn--secondary btn--sm" onClick={crmOpportunity}><TrendingUp size={15} /> Nova oportunidade</button>
        <button className="btn btn--secondary btn--sm" onClick={register}><ClipboardPlus size={15} /> Registrar</button>
        <button className="btn btn--secondary btn--sm" onClick={whatsapp} disabled={!patient.phone}><MessageCircle size={15} /> WhatsApp</button>
        <button className="btn btn--secondary btn--sm" onClick={() => setTab('notes')}><StickyNote size={15} /> Nova nota</button>
        <button className="btn btn--ghost btn--sm" onClick={() => setTab('data')}><Pencil size={15} /> Editar</button>
        <button className="btn btn--ghost btn--sm" onClick={() => void archiveOrRestore()}>{archived ? <RotateCcw size={15} /> : <Archive size={15} />}{archived ? 'Restaurar' : 'Arquivar'}</button>
      </div>

      <div className="sub-tabs" style={{ overflowX: 'auto', flexShrink: 0 }}>
        {TABS.map(([label, key]) => <button key={key} className={`sub-tab${tab === key ? ' sub-tab--active' : ''}`} onClick={() => setTab(key)}>{label}</button>)}
      </div>

      <div className="drawer-body">
        {tab === 'overview' ? <OverviewTab patientId={patient.id} onAgenda={schedule} onReturns={() => navigate(`/retornos?patient_id=${patient.id}`)} onHistory={() => setTab('procedures')} onFinance={() => setTab('finance')} onNotes={() => setTab('notes')} onAnamnesis={() => setTab('anamnesis')} onTimeline={() => setTab('timeline')} /> : <Suspense fallback={<div className="loading-state">Carregando...</div>}>
          {tab === 'timeline' && <TimelineTab patientId={patient.id} onOpen={openTimelineEvent} />}
          {tab === 'procedures' && <HistoricoTab patientId={patient.id} onPhotos={() => setTab('photos')} onInjectables={() => setTab('injectables')} onContract={procedureId => setSignatureRequest({ procedureId })} />}
          {tab === 'anamnesis' && <AnamneseTab patientId={patient.id} />}
          {tab === 'photos' && <FotosTab patientId={patient.id} />}
          {tab === 'injectables' && <InjetaveisTab patientId={patient.id} patientName={patient.name} />}
          {tab === 'finance' && <FinanceiroPacienteTab patientId={patient.id} />}
          {tab === 'contracts' && <ContratosTab patientId={patient.id} onSignNew={contractId => setSignatureRequest(contractId ? { contractId } : sourceAppointmentId ? { appointmentId: sourceAppointmentId } : {})} />}
          {tab === 'notes' && <NotasTab patientId={patient.id} />}
          {tab === 'data' && <DadosTab patient={patient} onUpdate={onUpdate} />}
        </Suspense>}
      </div>
    </aside>
  </div>;
}
