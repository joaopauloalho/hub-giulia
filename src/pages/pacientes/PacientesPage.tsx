import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Archive, Download, HeartPulse, Plus, Search, UserRound } from 'lucide-react';
import { usePacientes, type PatientRecord } from '../../hooks/usePacientes';
import { NovaClienteDrawer } from './NovaClienteDrawer';
import { PacienteView, type TabKey } from './PacienteView';
import { PatientJourneyBoard } from './PatientJourneyBoard';
import { Skeleton } from '../../components/ui/Skeleton';
import { exportPatientsCSV } from '../../lib/exportUtils';
import type { Patient } from '../../types';

type PatientViewMode = 'active' | 'journey' | 'archived';

const PATIENT_TABS: TabKey[] = ['overview', 'timeline', 'procedures', 'anamnesis', 'photos', 'injectables', 'finance', 'contracts', 'notes', 'data'];

export function PacientesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { patientId: routePatientId } = useParams();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<PatientViewMode>('active');
  const archiveMode = viewMode === 'archived' ? 'archived' : 'active';
  const { pacientes, total, loading, error, create, update, archive, restore, getById, nextPage, hasMore } = usePacientes({ search: viewMode === 'journey' ? '' : search, archiveMode });
  const [showCreate, setShowCreate] = useState(false);
  const [viewing, setViewing] = useState<PatientRecord | null>(null);
  const [sourceAppointmentId, setSourceAppointmentId] = useState<string | null>(null);
  const closingPatientIdRef = useRef<string | null>(null);
  const requestedPatientId = routePatientId ?? searchParams.get('patient_id');

  useEffect(() => {
    if (closingPatientIdRef.current && requestedPatientId !== closingPatientIdRef.current) {
      closingPatientIdRef.current = null;
    }
    if (loading || !requestedPatientId || closingPatientIdRef.current === requestedPatientId || viewing?.id === requestedPatientId) return;
    const found = pacientes.find(patient => patient.id === requestedPatientId);
    if (found) {
      setViewing(found);
      setSourceAppointmentId(searchParams.get('appointment_id'));
      return;
    }
    let active = true;
    getById(requestedPatientId).then(patient => {
      if (!active || !patient || closingPatientIdRef.current === requestedPatientId) return;
      setViewing(patient);
      setSourceAppointmentId(searchParams.get('appointment_id'));
    }).catch(() => { if (active) setSourceAppointmentId(null); });
    return () => { active = false; };
  }, [getById, loading, pacientes, requestedPatientId, searchParams, viewing?.id]);

  const requestedTab = searchParams.get('tab');
  const initialTab = PATIENT_TABS.includes(requestedTab as TabKey) ? requestedTab as TabKey : undefined;
  const filtered = pacientes.filter(patient => [patient.name, patient.phone, patient.email].some(value => value?.toLowerCase().includes(search.toLowerCase())));
  const initials = (name: string) => name.split(' ').slice(0, 2).map(word => word[0]).join('').toUpperCase();
  const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('pt-BR') : null;

  const closePatient = () => {
    closingPatientIdRef.current = requestedPatientId ?? viewing?.id ?? null;
    setViewing(null);
    setSourceAppointmentId(null);
    const returnTo = searchParams.get('return_to');
    const from = (location.state as { from?: string } | null)?.from;
    if (returnTo?.startsWith('/')) navigate(returnTo);
    else if (from) navigate(from);
    else if (requestedPatientId) navigate('/pacientes', { replace: true });
  };

  const openPatient = (patient: PatientRecord) => {
    closingPatientIdRef.current = null;
    setViewing(patient);
    setSourceAppointmentId(null);
    navigate(`/pacientes/${patient.id}`);
  };

  const openPatientById = async (patientId: string) => {
    try {
      const patient = await getById(patientId);
      if (patient) openPatient(patient);
    } catch (openError) {
      console.error('[patients:journey-open]', openError);
    }
  };

  const switchMode = (mode: PatientViewMode) => {
    setViewMode(mode);
    setViewing(null);
    navigate('/pacientes', { replace: true });
  };

  const subtitle = viewMode === 'journey'
    ? 'Jornada clínica e comercial · veja quem precisa de ação agora'
    : `${total} ${viewMode === 'archived' ? 'arquivada' : 'ativa'}${total === 1 ? '' : 's'}`;

  return <div className="page">
    <div className="page-header">
      <div><h1 className="page-title">Pacientes</h1><p className="page-sub">{subtitle}</p></div>
      {viewMode !== 'journey' && <button className="btn btn--secondary btn--sm" onClick={() => exportPatientsCSV(filtered)} disabled={filtered.length === 0}><Download size={16} /> CSV</button>}
    </div>

    <div style={{ display: 'flex', gap: 7, marginBottom: 10, overflowX: 'auto', paddingBottom: 2 }}>
      <button className={`btn btn--sm ${viewMode === 'active' ? 'btn--primary' : 'btn--ghost'}`} onClick={() => switchMode('active')}>Ativas</button>
      <button className={`btn btn--sm ${viewMode === 'journey' ? 'btn--primary' : 'btn--ghost'}`} onClick={() => switchMode('journey')}><HeartPulse size={14} /> Jornada</button>
      <button className={`btn btn--sm ${viewMode === 'archived' ? 'btn--primary' : 'btn--ghost'}`} onClick={() => switchMode('archived')}><Archive size={14} /> Arquivadas</button>
    </div>

    <div className="search-wrap"><Search size={18} className="search-icon" /><input className="search-input" placeholder={viewMode === 'journey' ? 'Buscar paciente na jornada...' : 'Buscar por nome, celular ou email...'} value={search} onChange={event => setSearch(event.target.value)} /></div>

    {viewMode === 'journey' ? <PatientJourneyBoard search={search} onOpenPatient={patientId => { void openPatientById(patientId); }} /> : error ? <div className="empty-state"><p>{error}</p></div> : loading ? <div className="patient-list">{Array.from({ length: 3 }, (_, index) => <div className="patient-item" key={index}><Skeleton width={44} height={44} borderRadius="50%" /><div style={{ flex: 1 }}><Skeleton lines={2} /></div></div>)}</div> : filtered.length === 0 ? <div className="empty-state"><UserRound size={48} strokeWidth={1} style={{ color: 'var(--primary-lt)' }} />{search ? <p>Nenhuma paciente encontrada para "{search}".</p> : viewMode === 'archived' ? <p>Nenhuma paciente arquivada.</p> : <><p>Nenhuma paciente cadastrada ainda.</p><button className="btn btn--primary btn--md" onClick={() => setShowCreate(true)}><Plus size={16} /> Cadastrar primeira paciente</button></>}</div> : <div className="patient-list">
      {filtered.map(patient => <div key={patient.id} className="patient-item" onClick={() => openPatient(patient)}><div className="avatar">{initials(patient.name)}</div><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text)' }}>{patient.name}</div><div className="page-sub">{[patient.phone, patient.profession].filter(Boolean).join(' · ')}</div></div>{(viewMode === 'archived' ? patient.archived_at : patient.created_at) && <div className="page-sub" style={{ flexShrink: 0 }}>{fmtDate(viewMode === 'archived' ? patient.archived_at : patient.created_at)}</div>}</div>)}
      {hasMore && <button className="btn btn--secondary btn--md" onClick={nextPage} style={{ marginTop: 8 }}>Carregar mais</button>}
    </div>}

    {viewMode === 'active' && <button className="fab" onClick={() => setShowCreate(true)} aria-label="Nova paciente"><Plus size={24} /></button>}
    <NovaClienteDrawer open={showCreate} onClose={() => setShowCreate(false)} onCreate={async data => { await create(data); setShowCreate(false); }} />

    {viewing && <PacienteView patient={viewing as Patient} archived={Boolean(viewing.archived_at)} sourceAppointmentId={sourceAppointmentId} initialTab={initialTab} onClose={closePatient} onUpdate={async data => { await update(viewing.id, data); setViewing(previous => previous ? { ...previous, ...data } : previous); }} onArchive={async () => { await archive(viewing.id); setViewing(null); navigate('/pacientes', { replace: true }); }} onRestore={async () => { await restore(viewing.id); setViewing(null); navigate('/pacientes', { replace: true }); }} />}
  </div>;
}
