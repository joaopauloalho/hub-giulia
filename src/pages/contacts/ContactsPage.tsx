import { useState } from 'react';
import { Plus, Search, Pencil, Trash2 } from 'lucide-react';
import { useContacts } from '../../hooks/useContacts';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import type { Contact } from '../../types';

type FormData = Omit<Contact, 'id' | 'user_id' | 'created_at'>;

const empty: FormData = { name: '', email: '', phone: '', company: '', status: 'active', notes: '' };

export function ContactsPage() {
  const { contacts, loading, create, update, remove } = useContacts();
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<{ open: boolean; editing: Contact | null }>({ open: false, editing: null });
  const [form, setForm] = useState<FormData>(empty);
  const [saving, setSaving] = useState(false);

  const filtered = contacts.filter(c =>
    [c.name, c.email, c.company, c.phone].some(v => v?.toLowerCase().includes(search.toLowerCase()))
  );

  const openCreate = () => { setForm(empty); setModal({ open: true, editing: null }); };
  const openEdit = (c: Contact) => {
    setForm({ name: c.name, email: c.email ?? '', phone: c.phone ?? '', company: c.company ?? '', status: c.status, notes: c.notes ?? '' });
    setModal({ open: true, editing: c });
  };
  const closeModal = () => setModal({ open: false, editing: null });

  const handleSave = async () => {
    setSaving(true);
    try {
      if (modal.editing) await update(modal.editing.id, form);
      else await create(form);
      closeModal();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este contato?')) return;
    await remove(id);
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Contatos</h1>
          <p className="page-sub">{contacts.length} contato{contacts.length !== 1 ? 's' : ''}</p>
        </div>
        <Button onClick={openCreate}>
          <Plus size={16} strokeWidth={2} /> Novo contato
        </Button>
      </div>

      <div className="toolbar">
        <div className="search-wrap">
          <Search size={16} className="search-icon" />
          <input
            className="search-input"
            placeholder="Buscar contatos..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="loading-state">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <p>{search ? 'Nenhum resultado.' : 'Ainda sem contatos. Crie o primeiro!'}</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Nome</th><th>Empresa</th><th>Email</th><th>Telefone</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id}>
                  <td>
                    <div className="cell-with-avatar">
                      <div className="avatar">{c.name[0].toUpperCase()}</div>
                      <span>{c.name}</span>
                    </div>
                  </td>
                  <td>{c.company ?? '—'}</td>
                  <td>{c.email ?? '—'}</td>
                  <td>{c.phone ?? '—'}</td>
                  <td>
                    <span className={`badge ${c.status === 'active' ? 'badge--green' : 'badge--gray'}`}>
                      {c.status === 'active' ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="icon-btn" onClick={() => openEdit(c)}><Pencil size={14} /></button>
                      <button className="icon-btn icon-btn--danger" onClick={() => handleDelete(c.id)}><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modal.open} onClose={closeModal} title={modal.editing ? 'Editar contato' : 'Novo contato'}>
        <div className="form-grid">
          <Input label="Nome *" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required />
          <Input label="Empresa" value={form.company ?? ''} onChange={e => setForm(p => ({ ...p, company: e.target.value }))} />
          <Input label="Email" type="email" value={form.email ?? ''} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} />
          <Input label="Telefone" value={form.phone ?? ''} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} />
          <div className="field">
            <label className="field-label">Status</label>
            <select className="field-input" value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value as 'active' | 'inactive' }))}>
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
            </select>
          </div>
          <div className="field field--full">
            <label className="field-label">Notas</label>
            <textarea className="field-input" rows={3} value={form.notes ?? ''} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
          </div>
        </div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={closeModal}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving || !form.name}>
            {saving ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
