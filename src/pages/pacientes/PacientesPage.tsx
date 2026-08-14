import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Archive, Download, Plus, Search, UserRound } from 'lucide-react';
import { usePacientes, type PatientRecord } from '../../hooks/usePacientes';
import { NovaClienteDrawer } from './NovaClienteDrawer';
import { PacienteView, type TabKey } from './PacienteView';
import { Skeleton } from '../../components/ui/Skeleton';
import { exportPatientsCSV } from '../../lib/exportUtils';
import type { Patient } from '../../types';

type ArchiveMode = 'active' | 'archived';

const PATIENT_TABS: TabKey[] = ['overview', 'timeline', 'procedures', 'anamnesis', 'photos', 'injectables', 'finance', 'contracts', 'notes', 'data'];

export function PacientesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [archiveMode, setArchiveMode] = useState<ArchiveMode>('active');
  const { pacientes, total, loading, error, create, update, archive, restore, getById, nextPage, hasMore } = usePacientes({ search, archiveMode });
  const [showCreate, setShowCreate] = useState(false);
  const [viewing, setViewing] = useState<PatientRecord | null>(null);
  const [sourceAppointmentId, setSourceAppointmentId] = useState<string | null>(null);

  useEffect(() => {
    if (loading || viewing) return;
    const patientId = searchParams.get('patient_id');
    if (!patientId) return;
    const found = pacientes.find(patient => patient.id === patientId);
    if (found) {
      setViewing(found);
      setSourceAppointmentId(searchParams.get('appointment_id'));
      return;
    }
    let active = true;
    getById(patientId).then(patient => {
      if (!active || !patient) return;
      setViewing(patient);
      setSourceAppointmentId(searchParams.get('appointment_id'));
    }).catch(() => { if (active) setSourceAppointmentId(null); });
    return () => { active = false; };
  }, [loading, pacientes, searchParams, viewing, getById]);

  const requestedTab = searchParams.get('tab');
  const initialTab = PATIENT_TABS.includes(requestedTab as TabKey) ? requestedTab as TabKey : undefined;
  const filtered = pacientes.filter(patient => [patient.name, patient.phone, patient.email].some(value => value?.toLowerCase().includes(search.toLowerCase())));
  const initials = (name: string) => name.split(' ').slice(0, 2).map(word => word[0]).join('').toUpperCase();
  const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('pt-BR') : null;
  const closePatient = () => {
    setViewing(null);
    setSourceAppointmentId(null);
    const from = (location.state as { from?: string } | null)?.from;
    if (searchParams.has('patient_id') && from) navigate(from);
    else if (searchParams.has('patient_id')) navigate('/pacientes', { replace: true });
  };

  return <div className="page">
    <div className="page-header">
      <div><h1 className="page-title">Pacientes</h1><p className="page-sub">{total} {archiveMode === 'archived' ? 'arquivada' : 'ativa'}{total === 1 ? '' : 's'}</p></div>
      <button className="btn btn--secondary btn--sm" onClick={() => exportPatientsCSV(filtered)} disabled={filtered.length === 0}><Download size={16} /> CSV</button>
    </div>

    <div style={{ display: 'flex', gap: 7, marginBottom: 10 }}>
      <button className={`btn btn--sm ${archiveMode === 'active' ? 'btn--primary' : 'btn--ghost'}`} onClick={() => { setArchiveMode('active'); setViewing(null); }}>Ativas</button>
      <button className={`btn btn--sm ${archiveMode === 'archived' ? 'btn--primary' : 'btn--ghost'}`} onClick={() => { setArchiveMode('archived'); setViewing(null); }}><Archive size={14} /> Arquivadas</button>
    </div>

    <div className="search-wrap"><Search size={18} className="search-icon" /><input className="search-input" placeholder="Buscar por nome, celular ou email..." value={search} onChange={event => setSearch(event.target.value)} /></div>

    {error ? <div className="empty-state"><p>{error}</p></div> : loading ? <div className="patient-list">{Array.from({ length: 3 }, (_, index) => <div className="patient-item" key={index}><Skeleton width={44} height={44} borderRadius="50%" /><div style={{ flex: 1 }}><Skeleton lines={2} /></div></div>)}</div> : filtered.length === 0 ? <div className="empty-state"><UserRound size={48} strokeWidth={1} style={{ color: 'var(--primary-lt)' }} />{search ? <p>Nenhuma paciente encontrada para "{search}".</p> : archiveMode === 'archived' ? <p>Nenhuma paciente arquivada.</p> : <><p>Nenhuma paciente cadastrada ainda.</p><button className="btn btn--primary btn--md" onClick={() => setShowCreate(true)}><Plus size={16} /> Cadastrar primeira paciente</button></>}</div> : <div className="patient-list">
      {filtered.map(patient => <div key={patient.id} className="patient-item" onClick={() => { setViewing(patient); setSourceAppointmentId(null); }}><div className="avatar">{initials(patient.name)}</div><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text)' }}>{patient.name}</div><div className="page-sub">{[patient.phone, patient.profession].filter(Boolean).join(' · ')}</div></div>{(archiveMode === 'archived' ? patient.archived_at : patient.created_at) && <div className="page-sub" style={{ flexShrink: 0 }}>{fmtDate(archiveMode === 'archived' ? patient.archived_at : patient.created_at)}</div>}</div>)}
      {hasMore && <button className="btn btn--secondary btn--md" onClick={nextPage} style={{ marginTop: 8 }}>Carregar mais</button>}
    </div>}

    {archiveMode === 'active' && <button className="fab" onClick={() => setShowCreate(true)} aria-label="Nova paciente"><Plus size={24} /></button>}
    <NovaClienteDrawer open={showCreate} onClose={() => setShowCreate(false)} onCreate={async data => { await create(data); setShowCreate(false); }} />

    {viewing && <PacienteView patient={viewing as Patient} archived={Boolean(viewing.archived_at)} sourceAppointmentId={sourceAppointmentId} initialTab={initialTab} onClose={closePatient} onUpdate={async data => { await update(viewing.id, data); setViewing(previous => previous ? { ...previous, ...data } : previous); }} onArchive={async () => { await archive(viewing.id); setViewing(null); }} onRestore={async () => { await restore(viewing.id); setViewing(null); }} />}
  </div>;
}
