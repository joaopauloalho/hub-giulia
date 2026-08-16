import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useToast } from '../../hooks/useToast';
import { ageLabel, birthDateIsoToInput, formatBirthDateInput, parseBirthDateInput } from '../../lib/dateUtils';
import { birthDateInputError, normalizePatientCreateData, patientCreateFriendlyError, validatePatientCreateData, type PatientCreateData } from '../../lib/patientInput';

const empty: PatientCreateData = {
  name: '', birth_date: null, phone: null, email: null, cpf: null, profession: null,
  civil_status: null, weight: null, height: null, instagram: null, emergency_name: null,
  emergency_phone: null, convenio: null, notes: null, photo_url: null, start_date: null,
};
interface Props { open: boolean; onClose: () => void; onCreate: (data: PatientCreateData) => Promise<void>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="field"><label className="field-label">{label}</label>{children}</div>; }

export function NovaClienteDrawer({ open, onClose, onCreate }: Props) {
  const { toast, confirm } = useToast();
  const [form, setForm] = useState<PatientCreateData>(empty);
  const [birthInput, setBirthInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);

  useEffect(() => { if (open) { setForm(empty); setBirthInput(''); setSaveError(null); setSaving(false); savingRef.current = false; } }, [open]);
  const dirty = useMemo(() => birthInput.trim().length > 0 || Object.entries(form).some(([key,value]) => key !== 'photo_url' && value !== null && value !== ''), [birthInput, form]);
  const requestClose = useCallback(async () => {
    if (savingRef.current || saving) return;
    if (!dirty) { onClose(); return; }
    const discard = await confirm({
      title: 'Descartar cadastro?',
      message: 'Os dados preenchidos desta paciente ainda não foram salvos.',
      confirmLabel: 'Descartar',
      cancelLabel: 'Continuar preenchendo',
      tone: 'warning',
    });
    if (discard) onClose();
  }, [confirm, dirty, onClose, saving]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (open && event.key === 'Escape') { event.preventDefault(); void requestClose(); } };
    document.addEventListener('keydown', handler); return () => document.removeEventListener('keydown', handler);
  }, [open, requestClose]);

  const set = (key: keyof PatientCreateData, value: string | null) => setForm(current => ({ ...current, [key]: value || null }));
  const handleSave = async () => {
    if (savingRef.current) return;
    const normalized = normalizePatientCreateData(form);
    const validationError = validatePatientCreateData(normalized); if (validationError) { setSaveError(validationError); return; }
    const dateError = birthDateInputError(birthInput); if (dateError) { setSaveError(dateError); return; }
    const birthDate = birthInput ? parseBirthDateInput(birthInput) : null; if (birthInput && !birthDate) { setSaveError('Data de nascimento inválida. Use dd/mm/aaaa.'); return; }
    savingRef.current = true; setSaving(true); setSaveError(null);
    try { await onCreate({ ...normalized, birth_date: birthDate }); toast.success('Paciente cadastrada com sucesso.'); }
    catch (error) { setSaveError(patientCreateFriendlyError(error)); }
    finally { savingRef.current = false; setSaving(false); }
  };
  if (!open) return null;

  return <div className="modal-overlay" data-testid="new-patient-backdrop">
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="nova-paciente-title" aria-busy={saving} style={{ maxWidth:560,borderRadius:'var(--radius-lg)' }}>
      <div className="modal-handle" />
      <div className="modal-header"><h2 className="modal-title" id="nova-paciente-title">Nova Paciente</h2><button type="button" className="modal-close" onClick={() => void requestClose()} disabled={saving} aria-label="Fechar cadastro"><X size={16}/></button></div>
      <div className="modal-body"><div className="form-grid">
        <div className="form-section-title">Dados Pessoais</div>
        <div className="field field--full"><label className="field-label">Nome completo *</label><input className="field-input" placeholder="Nome completo" value={form.name} onChange={e=>set('name',e.target.value)} autoFocus /></div>
        <Field label="Data de nascimento"><input className="field-input" type="text" inputMode="numeric" autoComplete="bday" placeholder="dd/mm/aaaa" value={birthInput || birthDateIsoToInput(form.birth_date)} onChange={e=>setBirthInput(formatBirthDateInput(e.target.value))}/>{ageLabel(parseBirthDateInput(birthInput))&&<span style={{fontSize:'0.78rem',color:'var(--text-3)'}}>Idade atual: {ageLabel(parseBirthDateInput(birthInput))}</span>}</Field>
        <Field label="Estado civil"><select className="field-input" value={form.civil_status??''} onChange={e=>set('civil_status',e.target.value)}><option value="">Selecionar</option><option>Solteira</option><option>Casada</option><option>Divorciada</option><option>Viúva</option><option>União estável</option></select></Field>
        <Field label="Celular"><input className="field-input" type="tel" placeholder="(00) 00000-0000" value={form.phone??''} onChange={e=>set('phone',e.target.value)}/></Field>
        <Field label="Email"><input className="field-input" type="email" placeholder="email@exemplo.com" value={form.email??''} onChange={e=>set('email',e.target.value)}/></Field>
        <Field label="CPF"><input className="field-input" inputMode="numeric" placeholder="000.000.000-00" value={form.cpf??''} onChange={e=>set('cpf',e.target.value)}/></Field>
        <Field label="Profissão"><input className="field-input" value={form.profession??''} onChange={e=>set('profession',e.target.value)}/></Field>
        <Field label="Instagram"><input className="field-input" placeholder="@usuario" value={form.instagram??''} onChange={e=>set('instagram',e.target.value)}/></Field>
        <Field label="Peso"><input className="field-input" placeholder="Ex: 65 kg" value={form.weight??''} onChange={e=>set('weight',e.target.value)}/></Field>
        <Field label="Altura"><input className="field-input" placeholder="Ex: 1,68 m" value={form.height??''} onChange={e=>set('height',e.target.value)}/></Field>
        <Field label="Convênio"><input className="field-input" value={form.convenio??''} onChange={e=>set('convenio',e.target.value)}/></Field>
        <div className="form-section-title">Contato de Emergência</div>
        <Field label="Nome"><input className="field-input" value={form.emergency_name??''} onChange={e=>set('emergency_name',e.target.value)}/></Field>
        <Field label="Celular"><input className="field-input" type="tel" placeholder="(00) 00000-0000" value={form.emergency_phone??''} onChange={e=>set('emergency_phone',e.target.value)}/></Field>
        <div className="form-section-title">Observações</div>
        <div className="field field--full"><label className="field-label">Notas / Motivo da consulta</label><textarea className="field-input" rows={3} placeholder="Motivo da consulta, observações iniciais..." value={form.notes??''} onChange={e=>set('notes',e.target.value)}/></div>
        <Field label="Data início (paciente antiga)"><input className="field-input" type="date" value={form.start_date??''} onChange={e=>set('start_date',e.target.value)}/></Field>
      </div></div>
      {saveError&&<div role="alert" style={{padding:'0 1.25rem 0.75rem',color:'var(--danger, #e53e3e)',fontSize:'0.85rem'}}>{saveError}</div>}
      <div className="modal-footer"><button type="button" className="btn btn--ghost btn--md w-full" onClick={()=>void requestClose()} disabled={saving}>Cancelar</button><button type="button" className="btn btn--primary btn--md w-full" onClick={()=>void handleSave()} disabled={saving||!form.name.trim()}>{saving?'Salvando...':'Cadastrar'}</button></div>
    </div>
  </div>;
}
