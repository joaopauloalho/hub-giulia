import { useState } from 'react';
import { Plus, Search, UserRound } from 'lucide-react';
import { usePacientes } from '../../hooks/usePacientes';
import { NovaClienteDrawer } from './NovaClienteDrawer';
import { PacienteView } from './PacienteView';
import type { Patient } from '../../types';

export function PacientesPage() {
  const { pacientes, loading, create, update, remove } = usePacientes();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [viewing, setViewing] = useState<Patient | null>(null);

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
            {pacientes.length} {pacientes.length === 1 ? 'paciente' : 'pacientes'}
          </p>
        </div>
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

      {loading ? (
        <div className="loading-state">Carregando...</div>
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
            <div key={p.id} className="patient-item" onClick={() => setViewing(p)}>
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
          onClose={() => setViewing(null)}
          onUpdate={async (data) => { await update(viewing.id, data); }}
          onDelete={async () => { await remove(viewing.id); setViewing(null); }}
        />
      )}
    </div>
  );
}
