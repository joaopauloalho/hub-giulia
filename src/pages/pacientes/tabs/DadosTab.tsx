import { useState, type ReactNode } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { Patient } from '../../../types';
import { ageLabel, birthDateIsoToInput, formatBirthDateInput, parseBirthDateInput } from '../../../lib/dateUtils';
import { AcquisitionFields } from '../../../components/patients/AcquisitionFields';
import { formatAcquisitionLabel, normalizeAcquisitionDraft } from '../../../lib/acquisition';

interface Props {
  patient: Patient;
  onUpdate: (data: Partial<Patient>) => Promise<void>;
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return <div className="patient-data-field">
    <span className="patient-data-field__label">{label}</span>
    <span className={value ? 'patient-data-field__value' : 'patient-data-empty'}>{value || 'Não informado'}</span>
  </div>;
}

function Card({ title, hint, wide = false, compact = false, children }: { title: string; hint?: string; wide?: boolean; compact?: boolean; children: ReactNode }) {
  const classes = ['patient-data-card', wide ? 'patient-data-card--wide' : '', compact ? 'patient-data-card--compact' : ''].filter(Boolean).join(' ');
  return <section className={classes}>
    <div className="patient-data-card__heading"><h3>{title}</h3>{hint && <span className="patient-data-card__hint">{hint}</span>}</div>
    {children}
  </section>;
}

const fmtDate = (iso: string | null) => {
  if (!iso) return null;
  try { return format(new Date(`${iso}T12:00:00`), 'dd/MM/yyyy', { locale: ptBR }); }
  catch { return iso; }
};

export function DadosTab({ patient, onUpdate }: Props) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Patient>>({});
  const [birthInput, setBirthInput] = useState('');
  const [birthError, setBirthError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
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
    setBirthError(null);
    setSaveError(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setBirthError(null);
    setSaveError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const birthDate = birthInput ? parseBirthDateInput(birthInput) : null;
      if (birthInput && !birthDate) {
        setBirthError('Informe uma data válida no formato dd/mm/aaaa.');
        return;
      }
      setBirthError(null);
      const acquisition = normalizeAcquisitionDraft({
        source: form.acquisition_source ?? null,
        sourceDetail: form.acquisition_source_detail ?? null,
        referredByPatientId: form.referred_by_patient_id ?? null,
        referrerName: form.referrer_name ?? null,
      });
      await onUpdate({
        ...form,
        birth_date: birthDate,
        acquisition_source: acquisition.source,
        acquisition_source_detail: acquisition.sourceDetail,
        referred_by_patient_id: acquisition.referredByPatientId,
        referrer_name: acquisition.referrerName,
      });
      setEditing(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Não foi possível salvar os dados da paciente.');
    } finally {
      setSaving(false);
    }
  };

  const set = (key: keyof Patient, value: string) => setForm(previous => ({ ...previous, [key]: value || null }));

  if (editing) {
    return <div className="patient-data-tab">
      <div className="patient-data-toolbar">
        <button className="btn btn--ghost btn--sm" type="button" onClick={cancelEdit} disabled={saving}><X size={14} /> Cancelar</button>
        <button className="btn btn--primary btn--sm" type="button" onClick={() => void handleSave()} disabled={saving}><Check size={14} /> {saving ? 'Salvando...' : 'Salvar alterações'}</button>
      </div>

      {saveError && <div className="empty-state" role="alert" style={{ marginBottom: 12, color: 'var(--red)' }}>{saveError}</div>}

      <div className="patient-data-grid">
        <Card title="Dados pessoais" hint="Identificação">
          <div className="patient-data-edit-fields">
            <div className="field field--full">
              <label className="field-label" htmlFor="patient-name">Nome *</label>
              <input id="patient-name" className="field-input" autoComplete="name" value={form.name ?? ''} onChange={event => set('name', event.target.value)} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="patient-birth">Data de nascimento</label>
              <input id="patient-birth" className="field-input" type="text" inputMode="numeric" autoComplete="bday" placeholder="dd/mm/aaaa" value={birthInput} aria-invalid={Boolean(birthError)} aria-describedby={birthError ? 'patient-birth-error' : undefined} onChange={event => { setBirthInput(formatBirthDateInput(event.target.value)); setBirthError(null); }} />
              {birthError ? <span id="patient-birth-error" style={{ fontSize: '.76rem', color: 'var(--red)' }}>{birthError}</span> : ageLabel(parseBirthDateInput(birthInput)) && <span style={{ fontSize: '.76rem', color: 'var(--text-3)' }}>Idade atual: {ageLabel(parseBirthDateInput(birthInput))}</span>}
            </div>
            <div className="field">
              <label className="field-label" htmlFor="patient-civil-status">Estado civil</label>
              <input id="patient-civil-status" className="field-input" value={form.civil_status ?? ''} onChange={event => set('civil_status', event.target.value)} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="patient-cpf">CPF</label>
              <input id="patient-cpf" className="field-input" inputMode="numeric" autoComplete="off" value={form.cpf ?? ''} onChange={event => set('cpf', event.target.value)} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="patient-profession">Profissão</label>
              <input id="patient-profession" className="field-input" autoComplete="organization-title" value={form.profession ?? ''} onChange={event => set('profession', event.target.value)} />
            </div>
          </div>
        </Card>

        <Card title="Contato" hint="Canais principais">
          <div className="patient-data-edit-fields">
            <div className="field">
              <label className="field-label" htmlFor="patient-phone">Celular</label>
              <input id="patient-phone" className="field-input" type="tel" inputMode="tel" autoComplete="tel" value={form.phone ?? ''} onChange={event => set('phone', event.target.value)} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="patient-email">E-mail</label>
              <input id="patient-email" className="field-input" type="email" inputMode="email" autoComplete="email" value={form.email ?? ''} onChange={event => set('email', event.target.value)} />
            </div>
            <div className="field field--full">
              <label className="field-label" htmlFor="patient-instagram">Instagram</label>
              <input id="patient-instagram" className="field-input" autoCapitalize="none" autoCorrect="off" value={form.instagram ?? ''} onChange={event => set('instagram', event.target.value)} />
            </div>
          </div>
        </Card>

        <Card title="Perfil clínico" hint="Dados rápidos" compact>
          <div className="patient-data-edit-fields">
            <div className="field">
              <label className="field-label" htmlFor="patient-weight">Peso</label>
              <input id="patient-weight" className="field-input" inputMode="decimal" value={form.weight ?? ''} onChange={event => set('weight', event.target.value)} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="patient-height">Altura</label>
              <input id="patient-height" className="field-input" inputMode="decimal" value={form.height ?? ''} onChange={event => set('height', event.target.value)} />
            </div>
            <div className="field field--full">
              <label className="field-label" htmlFor="patient-convenio">Convênio</label>
              <input id="patient-convenio" className="field-input" value={form.convenio ?? ''} onChange={event => set('convenio', event.target.value)} />
            </div>
          </div>
        </Card>

        <Card title="Origem" hint="Como chegou à clínica" compact>
          <AcquisitionFields idPrefix="edit-patient-acquisition" excludePatientId={patient.id} value={{ source: form.acquisition_source ?? null, sourceDetail: form.acquisition_source_detail ?? null, referredByPatientId: form.referred_by_patient_id ?? null, referrerName: form.referrer_name ?? null }} onChange={next => setForm(current => ({ ...current, acquisition_source: next.source, acquisition_source_detail: next.sourceDetail, referred_by_patient_id: next.referredByPatientId, referrer_name: next.referrerName }))} />
        </Card>

        <Card title="Emergência" hint="Contato de apoio" compact>
          <div className="patient-data-edit-fields">
            <div className="field">
              <label className="field-label" htmlFor="patient-emergency-name">Nome</label>
              <input id="patient-emergency-name" className="field-input" autoComplete="off" value={form.emergency_name ?? ''} onChange={event => set('emergency_name', event.target.value)} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="patient-emergency-phone">Celular</label>
              <input id="patient-emergency-phone" className="field-input" type="tel" inputMode="tel" value={form.emergency_phone ?? ''} onChange={event => set('emergency_phone', event.target.value)} />
            </div>
          </div>
        </Card>

        <Card title="Observações" hint="Contexto geral" wide>
          <div className="field">
            <label className="field-label" htmlFor="patient-notes">Notas</label>
            <textarea id="patient-notes" className="field-input" rows={4} value={form.notes ?? ''} onChange={event => set('notes', event.target.value)} />
          </div>
        </Card>
      </div>
    </div>;
  }

  const origin = formatAcquisitionLabel(patient.acquisition_source, patient.acquisition_source_detail, patient.referrer_name);

  return <div className="patient-data-tab">
    <div className="patient-data-toolbar">
      <button className="btn btn--secondary btn--sm" type="button" onClick={startEdit}><Pencil size={14} /> Editar dados</button>
    </div>

    <div className="patient-data-grid">
      <Card title="Dados pessoais" hint="Identificação">
        <div className="patient-data-fields">
          <Info label="Nascimento" value={fmtDate(patient.birth_date)} />
          <Info label="Idade" value={ageLabel(patient.birth_date)} />
          <Info label="Estado civil" value={patient.civil_status} />
          <Info label="CPF" value={patient.cpf} />
          <Info label="Profissão" value={patient.profession} />
          <Info label="Cadastrada em" value={fmtDate(patient.created_at)} />
        </div>
      </Card>

      <Card title="Contato" hint="Canais principais">
        <div className="patient-data-fields">
          <Info label="Celular" value={patient.phone} />
          <Info label="E-mail" value={patient.email} />
          <Info label="Instagram" value={patient.instagram} />
        </div>
      </Card>

      <Card title="Perfil clínico" hint="Dados rápidos" compact>
        <div className="patient-data-fields">
          <Info label="Peso" value={patient.weight} />
          <Info label="Altura" value={patient.height} />
          <Info label="Convênio" value={patient.convenio} />
        </div>
      </Card>

      <Card title="Origem" hint="Aquisição" compact>
        <Info label="Como conheceu a clínica" value={origin} />
      </Card>

      <Card title="Emergência" hint="Contato de apoio" compact>
        <div className="patient-data-fields">
          <Info label="Nome" value={patient.emergency_name} />
          <Info label="Celular" value={patient.emergency_phone} />
        </div>
      </Card>

      <Card title="Observações" hint="Contexto geral" wide>
        {patient.notes ? <p className="patient-data-notes">{patient.notes}</p> : <span className="patient-data-empty">Nenhuma observação registrada.</span>}
      </Card>
    </div>
  </div>;
}
