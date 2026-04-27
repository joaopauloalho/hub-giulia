import { useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { useDeals } from '../../hooks/useDeals';
import { useContacts } from '../../hooks/useContacts';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import type { Deal, DealStage } from '../../types';

type FormData = Omit<Deal, 'id' | 'user_id' | 'created_at' | 'contact'>;
const empty: FormData = { title: '', contact_id: null, value: null, stage: 'lead', expected_close: null };

const STAGES: { key: DealStage; label: string }[] = [
  { key: 'lead', label: 'Lead' },
  { key: 'qualified', label: 'Qualificado' },
  { key: 'proposal', label: 'Proposta' },
  { key: 'won', label: 'Ganho' },
  { key: 'lost', label: 'Perdido' },
];

const stageBadge: Record<DealStage, string> = {
  lead: 'badge--gray', qualified: 'badge--blue', proposal: 'badge--amber', won: 'badge--green', lost: 'badge--red',
};

export function DealsPage() {
  const { deals, loading, create, update, remove } = useDeals();
  const { contacts } = useContacts();
  const [modal, setModal] = useState<{ open: boolean; editing: Deal | null }>({ open: false, editing: null });
  const [form, setForm] = useState<FormData>(empty);
  const [saving, setSaving] = useState(false);

  const openCreate = () => { setForm(empty); setModal({ open: true, editing: null }); };
  const openEdit = (d: Deal) => {
    setForm({ title: d.title, contact_id: d.contact_id, value: d.value, stage: d.stage, expected_close: d.expected_close });
    setModal({ open: true, editing: d });
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
    if (!confirm('Excluir este negócio?')) return;
    await remove(id);
  };

  const totalPipeline = deals
    .filter(d => !['won', 'lost'].includes(d.stage))
    .reduce((s, d) => s + (d.value ?? 0), 0);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Negócios</h1>
          <p className="page-sub">Pipeline: R$ {totalPipeline.toLocaleString('pt-BR')}</p>
        </div>
        <Button onClick={openCreate}>
          <Plus size={16} strokeWidth={2} /> Novo negócio
        </Button>
      </div>

      {loading ? (
        <div className="loading-state">Carregando...</div>
      ) : (
        <div className="kanban">
          {STAGES.map(({ key, label }) => {
            const col = deals.filter(d => d.stage === key);
            const colTotal = col.reduce((s, d) => s + (d.value ?? 0), 0);
            return (
              <div key={key} className="kanban-col">
                <div className="kanban-col-header">
                  <span className={`badge ${stageBadge[key]}`}>{label}</span>
                  <span className="kanban-count">{col.length}</span>
                </div>
                {colTotal > 0 && (
                  <p className="kanban-total">R$ {colTotal.toLocaleString('pt-BR')}</p>
                )}
                <div className="kanban-cards">
                  {col.length === 0 ? (
                    <p className="kanban-empty">—</p>
                  ) : (
                    col.map(d => (
                      <div key={d.id} className="deal-card">
                        <div className="deal-card-header">
                          <p className="deal-card-title">{d.title}</p>
                          <div className="row-actions">
                            <button className="icon-btn" onClick={() => openEdit(d)}><Pencil size={13} /></button>
                            <button className="icon-btn icon-btn--danger" onClick={() => handleDelete(d.id)}><Trash2 size={13} /></button>
                          </div>
                        </div>
                        {d.contact && <p className="deal-card-contact">{d.contact.name}</p>}
                        {d.value != null && (
                          <p className="deal-card-value">R$ {d.value.toLocaleString('pt-BR')}</p>
                        )}
                        {d.expected_close && (
                          <p className="deal-card-date">{new Date(d.expected_close).toLocaleDateString('pt-BR')}</p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={modal.open} onClose={closeModal} title={modal.editing ? 'Editar negócio' : 'Novo negócio'}>
        <div className="form-grid">
          <Input label="Título *" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} required />
          <div className="field">
            <label className="field-label">Contato</label>
            <select className="field-input" value={form.contact_id ?? ''} onChange={e => setForm(p => ({ ...p, contact_id: e.target.value || null }))}>
              <option value="">Sem contato</option>
              {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <Input label="Valor (R$)" type="number" value={form.value ?? ''} onChange={e => setForm(p => ({ ...p, value: e.target.value ? Number(e.target.value) : null }))} />
          <div className="field">
            <label className="field-label">Etapa</label>
            <select className="field-input" value={form.stage} onChange={e => setForm(p => ({ ...p, stage: e.target.value as DealStage }))}>
              {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <Input label="Previsão de fechamento" type="date" value={form.expected_close ?? ''} onChange={e => setForm(p => ({ ...p, expected_close: e.target.value || null }))} />
        </div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={closeModal}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving || !form.title}>
            {saving ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
