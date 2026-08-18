import { useState } from 'react';
import { Pencil, Check, X } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { Patient } from '../../../types';
import { ageLabel, birthDateIsoToInput, formatBirthDateInput, parseBirthDateInput } from '../../../lib/dateUtils';
import { AcquisitionFields } from '../../../components/patients/AcquisitionFields';
import { normalizeAcquisitionDraft } from '../../../lib/acquisition';

interface Props {
  patient: Patient;
  onUpdate: (data: Partial<Patient>) => Promise<void>;
}

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="info-row">
      <span className="info-label">{label}</span>
      <span className="info-value">{value}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="section-title" style={{ marginTop: 20, marginBottom: 4 }}>{children}</div>;
}

const fmtDate = (iso: string | null) => {
  if (!iso) return null;
  try { return format(new Date(iso + 'T12:00:00'), 'dd/MM/yyyy', { locale: ptBR }); }
  catch { return iso; }
};

export function DadosTab({ patient, onUpdate }: Props) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Patient>>({});
  const [birthInput, setBirthInput] = useState('');
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setForm({
      name: patient.name,
      birth_date: patient.birth_date,
      phone: patient.phone,
      email: patient.email,
      cpf: patient.cpf,
      profession: patient.profession,
      civil_status: patient.civil_status,
      weight: patient.weight,
      height: patient.height,
      instagram: patient.instagram,
      emergency_name: patient.emergency_name,
      emergency_phone: patient.emergency_phone,
      convenio: patient.convenio,
      notes: patient.notes,
      acquisition_source: patient.acquisition_source,
      acquisition_source_detail: patient.acquisition_source_detail,
      referred_by_patient_id: patient.referred_by_patient_id,
      referrer_name: patient.referrer_name,
    });
    setBirthInput(birthDateIsoToInput(patient.birth_date));
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const birthDate = birthInput ? parseBirthDateInput(birthInput) : null;
      if (birthInput && !birthDate) return;
      const acquisition = normalizeAcquisitionDraft({ source: form.acquisition_source ?? null, sourceDetail: form.acquisition_source_detail ?? null, referredByPatientId: form.referred_by_patient_id ?? null, referrerName: form.referrer_name ?? null });
      await onUpdate({ ...form, birth_date: birthDate, acquisition_source: acquisition.source, acquisition_source_detail: acquisition.sourceDetail, referred_by_patient_id: acquisition.referredByPatientId, referrer_name: acquisition.referrerName });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const set = (key: keyof Patient, v: string) =>
    setForm(p => ({ ...p, [key]: v || null }));

  if (editing) {
    return (
      <div style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 16 }}>
          <button className="btn btn--ghost btn--sm" onClick={() => setEditing(false)}>
            <X size={14} /> Cancelar
          </button>
          <button className="btn btn--primary btn--sm" onClick={handleSave} disabled={saving}>
            <Check size={14} /> {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
        <div className="form-grid">
          <div className="form-section-title">Dados Pessoais</div>
          <div className="field field--full">
            <label className="field-label">Nome *</label>
            <input className="field-input" value={form.name ?? ''} onChange={e => set('name', e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label">Data de nascimento</label>
            <input
              className="field-input"
              type="text"
              inputMode="numeric"
              autoComplete="bday"
              placeholder="dd/mm/aaaa"
              value={birthInput}
              onChange={e => setBirthInput(formatBirthDateInput(e.target.value))}
            />
            {ageLabel(parseBirthDateInput(birthInput)) && (
              <span style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>
                Idade atual: {ageLabel(parseBirthDateInput(birthInput))}
              </span>
            )}
          </div>
          {([
            ['civil_status', 'Estado civil', 'text'],
            ['phone', 'Celular', 'tel'],
            ['email', 'Email', 'email'],
            ['cpf', 'CPF', 'text'],
            ['profession', 'Profissão', 'text'],
            ['instagram', 'Instagram', 'text'],
            ['weight', 'Peso', 'text'],
            ['height', 'Altura', 'text'],
            ['convenio', 'Convênio', 'text'],
          ] as [keyof Patient, string, string][]).map(([key, label, type]) => (
            <div key={key} className="field">
              <label className="field-label">{label}</label>
              <input className="field-input" type={type}
                value={(form[key] as string) ?? ''}
                onChange={e => set(key, e.target.value)} />
            </div>
          ))}
          <div className="form-section-title">Origem</div>
          <div className="field field--full"><AcquisitionFields idPrefix="edit-patient-acquisition" excludePatientId={patient.id} value={{ source: form.acquisition_source ?? null, sourceDetail: form.acquisition_source_detail ?? null, referredByPatientId: form.referred_by_patient_id ?? null, referrerName: form.referrer_name ?? null }} onChange={next=>setForm(current=>({ ...current, acquisition_source: next.source, acquisition_source_detail: next.sourceDetail, referred_by_patient_id: next.referredByPatientId, referrer_name: next.referrerName }))}/></div>
          <div className="form-section-title">Emergência</div>
          <div className="field">
            <label className="field-label">Nome</label>
            <input className="field-input" value={form.emergency_name ?? ''}
              onChange={e => set('emergency_name', e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label">Celular</label>
            <input className="field-input" type="tel" value={form.emergency_phone ?? ''}
              onChange={e => set('emergency_phone', e.target.value)} />
          </div>
          <div className="form-section-title">Observações</div>
          <div className="field field--full">
            <label className="field-label">Notas</label>
            <textarea className="field-input" rows={3} value={form.notes ?? ''}
              onChange={e => set('notes', e.target.value)} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn--ghost btn--sm" onClick={startEdit}>
          <Pencil size={14} /> Editar
        </button>
      </div>

      <SectionTitle>Dados Pessoais</SectionTitle>
      <Row label="Data de nascimento" value={fmtDate(patient.birth_date)} />
      <Row label="Idade atual" value={ageLabel(patient.birth_date)} />
      <Row label="Estado civil" value={patient.civil_status} />
      <Row label="Celular" value={patient.phone} />
      <Row label="Email" value={patient.email} />
      <Row label="CPF" value={patient.cpf} />
      <Row label="Profissão" value={patient.profession} />
      <Row label="Instagram" value={patient.instagram} />
      <Row label="Peso" value={patient.weight} />
      <Row label="Altura" value={patient.height} />
      <Row label="Convênio" value={patient.convenio} />
      <Row label="Cadastrada em" value={fmtDate(patient.created_at)} />

      {(patient.emergency_name || patient.emergency_phone) && (
        <>
          <SectionTitle>Emergência</SectionTitle>
          <Row label="Nome" value={patient.emergency_name} />
          <Row label="Celular" value={patient.emergency_phone} />
        </>
      )}

      {patient.notes && (
        <>
          <SectionTitle>Observações</SectionTitle>
          <div style={{ fontSize: '0.9rem', color: 'var(--text-2)', lineHeight: 1.6, marginTop: 8 }}>
            {patient.notes}
          </div>
        </>
      )}
    </div>
  );
}
