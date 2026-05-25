import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import type { Patient } from '../../types';

type CreateData = Omit<Patient, 'id' | 'user_id' | 'created_at'>;

const empty: CreateData = {
  name: '', birth_date: null, phone: null, email: null,
  cpf: null, profession: null, civil_status: null, weight: null, height: null,
  instagram: null, emergency_name: null, emergency_phone: null,
  convenio: null, notes: null, photo_url: null, start_date: null,
};

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (data: CreateData) => Promise<void>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      {children}
    </div>
  );
}

export function NovaClienteDrawer({ open, onClose, onCreate }: Props) {
  const [form, setForm] = useState<CreateData>(empty);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setForm(empty); setSaveError(null); }
  }, [open]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const set = (key: keyof CreateData, value: string | null) =>
    setForm(p => ({ ...p, [key]: value || null }));

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onCreate(form);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Erro ao cadastrar. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nova-paciente-title"
        style={{ maxWidth: 560, borderRadius: 'var(--radius-lg)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-handle" />
        <div className="modal-header">
          <h2 className="modal-title" id="nova-paciente-title">Nova Paciente</h2>
          <button className="modal-close" onClick={onClose} aria-label="Fechar cadastro"><X size={16} /></button>
        </div>

        <div className="modal-body">
          <div className="form-grid">
            <div className="form-section-title">Dados Pessoais</div>

            <div className="field field--full">
              <label className="field-label">Nome completo *</label>
              <input
                className="field-input"
                placeholder="Nome completo"
                value={form.name}
                onChange={e => set('name', e.target.value)}
                autoFocus
              />
            </div>

            <Field label="Data de nascimento">
              <input className="field-input" type="date" value={form.birth_date ?? ''}
                onChange={e => set('birth_date', e.target.value)} />
            </Field>

            <Field label="Estado civil">
              <select className="field-input" value={form.civil_status ?? ''}
                onChange={e => set('civil_status', e.target.value)}>
                <option value="">Selecionar</option>
                <option>Solteira</option>
                <option>Casada</option>
                <option>Divorciada</option>
                <option>Viúva</option>
                <option>União estável</option>
              </select>
            </Field>

            <Field label="Celular">
              <input className="field-input" type="tel" placeholder="(00) 00000-0000"
                value={form.phone ?? ''} onChange={e => set('phone', e.target.value)} />
            </Field>

            <Field label="Email">
              <input className="field-input" type="email" placeholder="email@exemplo.com"
                value={form.email ?? ''} onChange={e => set('email', e.target.value)} />
            </Field>

            <Field label="CPF">
              <input className="field-input" inputMode="numeric" placeholder="000.000.000-00"
                value={form.cpf ?? ''} onChange={e => set('cpf', e.target.value)} />
            </Field>

            <Field label="Profissão">
              <input className="field-input" value={form.profession ?? ''}
                onChange={e => set('profession', e.target.value)} />
            </Field>

            <Field label="Instagram">
              <input className="field-input" placeholder="@usuario"
                value={form.instagram ?? ''} onChange={e => set('instagram', e.target.value)} />
            </Field>

            <Field label="Peso">
              <input className="field-input" placeholder="Ex: 65 kg"
                value={form.weight ?? ''} onChange={e => set('weight', e.target.value)} />
            </Field>

            <Field label="Altura">
              <input className="field-input" placeholder="Ex: 1,68 m"
                value={form.height ?? ''} onChange={e => set('height', e.target.value)} />
            </Field>

            <Field label="Convênio">
              <input className="field-input" value={form.convenio ?? ''}
                onChange={e => set('convenio', e.target.value)} />
            </Field>

            <div className="form-section-title">Contato de Emergência</div>

            <Field label="Nome">
              <input className="field-input" value={form.emergency_name ?? ''}
                onChange={e => set('emergency_name', e.target.value)} />
            </Field>

            <Field label="Celular">
              <input className="field-input" type="tel" placeholder="(00) 00000-0000"
                value={form.emergency_phone ?? ''} onChange={e => set('emergency_phone', e.target.value)} />
            </Field>

            <div className="form-section-title">Observações</div>

            <div className="field field--full">
              <label className="field-label">Notas / Motivo da consulta</label>
              <textarea
                className="field-input"
                rows={3}
                placeholder="Motivo da consulta, observações iniciais..."
                value={form.notes ?? ''}
                onChange={e => set('notes', e.target.value)}
              />
            </div>

            <Field label="Data início (paciente antiga)">
              <input className="field-input" type="date" value={form.start_date ?? ''}
                onChange={e => set('start_date', e.target.value)} />
            </Field>
          </div>
        </div>

        {saveError && (
          <div style={{ padding: '0 1.25rem 0.75rem', color: 'var(--danger, #e53e3e)', fontSize: '0.85rem' }}>
            {saveError}
          </div>
        )}

        <div className="modal-footer">
          <button className="btn btn--ghost btn--md w-full" onClick={onClose}>Cancelar</button>
          <button
            className="btn btn--primary btn--md w-full"
            onClick={handleSave}
            disabled={saving || !form.name.trim()}
          >
            {saving ? 'Salvando...' : 'Cadastrar'}
          </button>
        </div>
      </div>
    </div>
  );
}
