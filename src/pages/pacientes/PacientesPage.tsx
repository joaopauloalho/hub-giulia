import { useState } from 'react';
import { Plus, Search, Eye, Pencil, Trash2, UserRound } from 'lucide-react';
import { usePacientes } from '../../hooks/usePacientes';
import { NovaClienteDrawer } from './NovaClienteDrawer';
import { PacienteView } from './PacienteView';
import type { Paciente } from '../../types';

export function PacientesPage() {
  const { pacientes, loading, create, update, remove } = usePacientes();
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<{ open: boolean; editing: Paciente | null }>({ open: false, editing: null });
  const [viewing, setViewing] = useState<Paciente | null>(null);

  const filtered = pacientes.filter(p =>
    [p.nome, p.celular, p.email, p.profissao, p.motivoConsulta]
      .some(v => v?.toLowerCase().includes(search.toLowerCase()))
  );

  const openCreate = () => setDrawer({ open: true, editing: null });
  const openEdit = (p: Paciente) => {
    setViewing(null);
    setDrawer({ open: true, editing: p });
  };
  const closeDrawer = () => setDrawer({ open: false, editing: null });

  const handleSave = (data: Omit<Paciente, 'id' | 'createdAt'>) => {
    if (drawer.editing) update(drawer.editing.id, data);
    else create(data);
  };

  const handleDelete = (p: Paciente) => {
    if (!confirm(`Excluir a ficha de ${p.nome}?`)) return;
    remove(p.id);
    if (viewing?.id === p.id) setViewing(null);
  };

  const fmtDate = (iso: string) =>
    iso ? new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR') : '—';

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Pacientes</h1>
          <p className="page-sub">{pacientes.length} {pacientes.length === 1 ? 'paciente' : 'pacientes'} cadastrada{pacientes.length !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn btn--primary btn--md" onClick={openCreate}>
          <Plus size={16} strokeWidth={2} /> Nova Cliente
        </button>
      </div>

      <div className="toolbar">
        <div className="search-wrap">
          <Search size={16} className="search-icon" />
          <input
            className="search-input"
            placeholder="Buscar por nome, celular, email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="loading-state">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          {search ? (
            <p>Nenhuma paciente encontrada para "{search}".</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <UserRound size={36} strokeWidth={1} style={{ color: 'var(--text-3)' }} />
              <p>Nenhuma paciente cadastrada ainda.</p>
              <button className="btn btn--primary btn--md" onClick={openCreate}>
                <Plus size={16} /> Cadastrar primeira cliente
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Celular</th>
                <th>Profissão</th>
                <th>Consulta</th>
                <th>Motivo</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setViewing(p)}>
                  <td>
                    <div className="cell-with-avatar">
                      <div className="avatar">{p.nome[0]?.toUpperCase() ?? '?'}</div>
                      <div>
                        <span style={{ display: 'block' }}>{p.nome}</span>
                        {p.idade && <span style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>{p.idade} anos</span>}
                      </div>
                    </div>
                  </td>
                  <td>{p.celular || '—'}</td>
                  <td>{p.profissao || '—'}</td>
                  <td>{fmtDate(p.dataConsulta)}</td>
                  <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.motivoConsulta || '—'}
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <div className="row-actions">
                      <button className="icon-btn" title="Ver ficha" onClick={() => setViewing(p)}><Eye size={14} /></button>
                      <button className="icon-btn" title="Editar" onClick={() => openEdit(p)}><Pencil size={14} /></button>
                      <button className="icon-btn icon-btn--danger" title="Excluir" onClick={() => handleDelete(p)}><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NovaClienteDrawer
        open={drawer.open}
        onClose={closeDrawer}
        onSave={handleSave}
        initial={drawer.editing}
      />

      <PacienteView
        paciente={viewing}
        onClose={() => setViewing(null)}
        onEdit={() => viewing && openEdit(viewing)}
      />
    </div>
  );
}
