import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Plus, Search, UserRound } from 'lucide-react';
import { usePacientes } from '../../hooks/usePacientes';
import { NovaClienteDrawer } from './NovaClienteDrawer';
import { PacienteView } from './PacienteView';
import { Skeleton } from '../../components/ui/Skeleton';
import { exportPatientsCSV } from '../../lib/exportUtils';
import type { Patient } from '../../types';

export function PacientesPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const { pacientes, total, loading, error, create, update, remove, getById, nextPage, hasMore } = usePacientes({ search });
  const [showCreate, setShowCreate] = useState(false);
  const [viewing, setViewing] = useState<Patient | null>(null);
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
    }).catch(() => {
      if (active) setSourceAppointmentId(null);
    });
    return () => { active = false; };
  }, [loading, pacientes, searchParams, viewing, getById]);

  const filtered = pacientes.filter(p =>
    [p.name, p.phone, p.email]
      .some(v => v?.toLowerCase().includes(search.toLowerCase()))
  );

  const initials = (name: string) =>
    name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('pt-BR') : null;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Pacientes</h1>
          <p className="page-sub">
            {total} {total === 1 ? 'paciente' : 'pacientes'}
          </p>
        </div>
        <button className="btn btn--secondary btn--sm" onClick={() => exportPatientsCSV(filtered)} disabled={filtered.length === 0}>
          <Download size={16} /> CSV
        </button>
      </div>

      <div className="search-wrap">
        <Search size={18} className="search-icon" />
        <input
          className="search-input"
          placeholder="Buscar por nome, celular ou email..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {error ? (
        <div className="empty-state">
          <p>{error}</p>
        </div>
      ) : loading ? (
        <div className="patient-list">
          {Array.from({ length: 3 }, (_, index) => (
            <div className="patient-item" key={index}>
              <Skeleton width={44} height={44} borderRadius="50%" />
              <div style={{ flex: 1 }}><Skeleton lines={2} /></div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <UserRound size={48} strokeWidth={1} style={{ color: 'var(--primary-lt)' }} />
          {search ? (
            <p>Nenhuma paciente encontrada para "{search}".</p>
          ) : (
            <>
              <p>Nenhuma paciente cadastrada ainda.</p>
              <button className="btn btn--primary btn--md" onClick={() => setShowCreate(true)}>
                <Plus size={16} /> Cadastrar primeira paciente
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="patient-list">
          {filtered.map(p => (
            <div key={p.id} className="patient-item" onClick={() => { setViewing(p); setSourceAppointmentId(null); }}>
              <div className="avatar">{initials(p.name)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text)' }}>
                  {p.name}
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-3)', marginTop: 2 }}>
                  {[p.phone, p.profession].filter(Boolean).join(' · ')}
                </div>
              </div>
              {p.created_at && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', flexShrink: 0 }}>
                  {fmtDate(p.created_at)}
                </div>
              )}
            </div>
          ))}
          {hasMore && (
            <button className="btn btn--secondary btn--md" onClick={nextPage} style={{ marginTop: 8 }}>
              Carregar mais
            </button>
          )}
        </div>
      )}

      <button className="fab" onClick={() => setShowCreate(true)} aria-label="Nova paciente">
        <Plus size={24} />
      </button>

      <NovaClienteDrawer
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={async (data) => {
          await create(data);
          setShowCreate(false);
        }}
      />

      {viewing && (
        <PacienteView
          patient={viewing}
          sourceAppointmentId={sourceAppointmentId}
          onClose={() => {
            setViewing(null);
            setSourceAppointmentId(null);
            if (searchParams.has('patient_id')) navigate('/pacientes', { replace: true });
          }}
          onUpdate={async (data) => { await update(viewing.id, data); setViewing(prev => prev ? { ...prev, ...data } : prev); }}
          onDelete={async () => { await remove(viewing.id); setViewing(null); }}
        />
      )}
    </div>
  );
}
