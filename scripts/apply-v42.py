from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')


def replace(path: str, old: str, new: str, count: int = 1) -> None:
    content = read(path)
    actual = content.count(old)
    if actual < count:
        raise RuntimeError(f'{path}: expected at least {count} occurrences, found {actual}: {old[:120]!r}')
    content = content.replace(old, new, count)
    write(path, content)


# -----------------------------------------------------------------------------
# Shared acquisition domain
# -----------------------------------------------------------------------------
write('src/lib/acquisition.ts', r'''export const ACQUISITION_SOURCE_KEYS = [
  'instagram',
  'referral',
  'google',
  'partnership',
  'existing_patient',
  'campaign',
  'other',
] as const;

export type AcquisitionSource = typeof ACQUISITION_SOURCE_KEYS[number];

export const ACQUISITION_SOURCE_LABEL: Record<AcquisitionSource, string> = {
  instagram: 'Instagram',
  referral: 'Indicação',
  google: 'Google',
  partnership: 'Parceria',
  existing_patient: 'Já conhecia / paciente antiga',
  campaign: 'Campanha',
  other: 'Outro',
};

export const ACQUISITION_DETAIL_SOURCES: AcquisitionSource[] = ['partnership', 'campaign', 'other'];

export type AcquisitionDraft = {
  source: AcquisitionSource | null;
  sourceDetail: string | null;
  referredByPatientId: string | null;
  referrerName: string | null;
};

export const emptyAcquisitionDraft = (): AcquisitionDraft => ({
  source: null,
  sourceDetail: null,
  referredByPatientId: null,
  referrerName: null,
});

const clean = (value: string | null | undefined) => value?.trim() || null;

export function normalizeAcquisitionDraft(input: AcquisitionDraft): AcquisitionDraft {
  const source = input.source ?? null;
  let sourceDetail = clean(input.sourceDetail);
  let referredByPatientId = clean(input.referredByPatientId);
  let referrerName = clean(input.referrerName);

  if (!source) return emptyAcquisitionDraft();

  if (!ACQUISITION_DETAIL_SOURCES.includes(source)) sourceDetail = null;

  if (source !== 'referral') {
    referredByPatientId = null;
    referrerName = null;
  } else {
    sourceDetail = null;
    if (referredByPatientId) referrerName = null;
  }

  return { source, sourceDetail, referredByPatientId, referrerName };
}

export function formatAcquisitionLabel(
  source: AcquisitionSource | null | undefined,
  sourceDetail?: string | null,
  referrerName?: string | null,
): string {
  if (!source) return 'Não informada';
  const base = ACQUISITION_SOURCE_LABEL[source];
  if (source === 'referral' && clean(referrerName)) return `${base} — ${clean(referrerName)}`;
  if (ACQUISITION_DETAIL_SOURCES.includes(source) && clean(sourceDetail)) return `${base} — ${clean(sourceDetail)}`;
  return base;
}
''')

# CRM imports the exact same acquisition taxonomy; legacy DB values are not offered in UI.
replace('src/lib/crm.ts',
"import { normalizePhone } from './patientInput';\n",
"import { normalizePhone } from './patientInput';\nimport { ACQUISITION_SOURCE_KEYS, ACQUISITION_SOURCE_LABEL, type AcquisitionSource } from './acquisition';\n")
replace('src/lib/crm.ts', r'''export const CRM_SOURCE_KEYS = ['instagram', 'whatsapp', 'referral', 'google', 'existing_patient', 'campaign', 'other'] as const;
export type CrmSource = typeof CRM_SOURCE_KEYS[number];

export const CRM_SOURCE_LABEL: Record<CrmSource, string> = {
  instagram: 'Instagram',
  whatsapp: 'WhatsApp',
  referral: 'Indicação',
  google: 'Google',
  existing_patient: 'Paciente existente',
  campaign: 'Campanha',
  other: 'Outro',
};
''', r'''export const CRM_SOURCE_KEYS = ACQUISITION_SOURCE_KEYS;
export type CrmSource = AcquisitionSource;
export const CRM_SOURCE_LABEL = ACQUISITION_SOURCE_LABEL;
''')

# Patient model + normalization
replace('src/types/index.ts',
"export interface Patient {\n",
"import type { AcquisitionSource } from '../lib/acquisition';\n\nexport interface Patient {\n")
replace('src/types/index.ts',
"  start_date: string | null;\n  created_at: string;\n",
"  start_date: string | null;\n  acquisition_source: AcquisitionSource | null;\n  acquisition_source_detail: string | null;\n  referred_by_patient_id: string | null;\n  referrer_name: string | null;\n  created_at: string;\n")
replace('src/lib/patientInput.ts',
"import type { Patient } from '../types';\n",
"import type { Patient } from '../types';\nimport { normalizeAcquisitionDraft } from './acquisition';\n")
replace('src/lib/patientInput.ts',
"  const cpf = data.cpf?.replace(/\\D/g, '') || null;\n\n  return {\n",
"  const cpf = data.cpf?.replace(/\\D/g, '') || null;\n  const acquisition = normalizeAcquisitionDraft({\n    source: data.acquisition_source,\n    sourceDetail: data.acquisition_source_detail,\n    referredByPatientId: data.referred_by_patient_id,\n    referrerName: data.referrer_name,\n  });\n\n  return {\n")
replace('src/lib/patientInput.ts',
"    emergency_phone: normalizePhone(data.emergency_phone),\n",
"    emergency_phone: normalizePhone(data.emergency_phone),\n    acquisition_source: acquisition.source,\n    acquisition_source_detail: acquisition.sourceDetail,\n    referred_by_patient_id: acquisition.referredByPatientId,\n    referrer_name: acquisition.referrerName,\n")

# -----------------------------------------------------------------------------
# Reusable patient acquisition/referrer input
# -----------------------------------------------------------------------------
write('src/components/patients/AcquisitionFields.tsx', r'''import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  ACQUISITION_DETAIL_SOURCES,
  ACQUISITION_SOURCE_KEYS,
  ACQUISITION_SOURCE_LABEL,
  type AcquisitionDraft,
  type AcquisitionSource,
} from '../../lib/acquisition';

type PatientCandidate = { id: string; name: string; phone: string | null; archived_at: string | null };

type Props = {
  value: AcquisitionDraft;
  onChange: (value: AcquisitionDraft) => void;
  excludePatientId?: string | null;
  idPrefix?: string;
};

export function AcquisitionFields({ value, onChange, excludePatientId = null, idPrefix = 'acquisition' }: Props) {
  const [mode, setMode] = useState<'linked' | 'manual'>(() => value.referrerName && !value.referredByPatientId ? 'manual' : 'linked');
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<PatientCandidate[]>([]);
  const [selected, setSelected] = useState<PatientCandidate | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!value.referredByPatientId) { setSelected(null); return; }
    let alive = true;
    void supabase.from('patients').select('id,name,phone,archived_at').eq('id', value.referredByPatientId).maybeSingle().then(({ data }) => {
      if (alive && data) setSelected(data as PatientCandidate);
    });
    return () => { alive = false; };
  }, [value.referredByPatientId]);

  useEffect(() => {
    if (value.source !== 'referral' || mode !== 'linked' || query.trim().length < 2) { setCandidates([]); return; }
    const timer = window.setTimeout(() => {
      let request = supabase.from('patients').select('id,name,phone,archived_at').ilike('name', `%${query.trim().replace(/[%_]/g, '')}%`).order('name').limit(8);
      if (excludePatientId) request = request.neq('id', excludePatientId);
      setLoading(true);
      void request.then(({ data, error }) => {
        if (!error) setCandidates((data ?? []) as PatientCandidate[]);
        setLoading(false);
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [excludePatientId, mode, query, value.source]);

  const detailLabel = useMemo(() => value.source === 'partnership' ? 'Qual parceria?' : value.source === 'campaign' ? 'Qual campanha?' : 'Qual?', [value.source]);
  const setSource = (source: AcquisitionSource | null) => onChange({ ...value, source });

  return <div data-testid={`${idPrefix}-fields`} style={{ display: 'grid', gap: 10 }}>
    <div className="field">
      <label className="field-label" htmlFor={`${idPrefix}-source`}>Como conheceu a clínica?</label>
      <select
        id={`${idPrefix}-source`}
        data-testid={`${idPrefix}-source`}
        className="field-input"
        value={value.source ?? ''}
        onChange={event => setSource((event.target.value || null) as AcquisitionSource | null)}
        style={{ minHeight: 44 }}
      >
        <option value="">Não informado</option>
        {ACQUISITION_SOURCE_KEYS.map(source => <option key={source} value={source}>{ACQUISITION_SOURCE_LABEL[source]}</option>)}
      </select>
      {!value.source && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Opcional — pode ser preenchido depois.</span>}
    </div>

    {value.source === 'referral' && <div style={{ display: 'grid', gap: 9 }}>
      <div className="field-label">Quem indicou?</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" className={`btn btn--sm ${mode === 'linked' ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setMode('linked')}>Buscar paciente</button>
        <button type="button" className={`btn btn--sm ${mode === 'manual' ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setMode('manual')}>Pessoa não cadastrada</button>
      </div>
      {mode === 'linked' ? <div style={{ position: 'relative' }}>
        {selected && value.referredByPatientId ? <div className="card" style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}><strong>{selected.name}</strong>{selected.archived_at && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-3)' }}>(arquivada)</span>}{selected.phone && <div className="page-sub">{selected.phone}</div>}</div>
          <button type="button" className="icon-btn" aria-label="Remover paciente indicadora" onClick={() => { onChange({ ...value, referredByPatientId: null }); setSelected(null); setQuery(''); }}><X size={16} /></button>
        </div> : <>
          <div style={{ position: 'relative' }}><Search size={15} style={{ position: 'absolute', left: 11, top: 14, color: 'var(--text-3)' }} /><input data-testid={`${idPrefix}-referrer-search`} className="field-input" style={{ paddingLeft: 34, minHeight: 44 }} value={query} onChange={event => setQuery(event.target.value)} placeholder="Digite o nome da paciente" /></div>
          {query.trim().length >= 2 && <div className="card" style={{ marginTop: 4, padding: 4, maxHeight: 220, overflowY: 'auto' }}>
            {loading ? <div className="page-sub" style={{ padding: 10 }}>Buscando…</div> : candidates.length === 0 ? <div className="page-sub" style={{ padding: 10 }}>Nenhuma paciente encontrada.</div> : candidates.map(candidate => <button
              type="button"
              key={candidate.id}
              data-testid={`${idPrefix}-referrer-option`}
              className="btn btn--ghost btn--md"
              style={{ width: '100%', justifyContent: 'flex-start', minHeight: 44, textAlign: 'left' }}
              onClick={() => { setSelected(candidate); setQuery(''); onChange({ ...value, referredByPatientId: candidate.id, referrerName: null }); }}
            ><span><strong>{candidate.name}</strong>{candidate.archived_at && <span style={{ marginLeft: 6, fontSize: 11 }}>(arquivada)</span>}{candidate.phone && <span className="page-sub" style={{ display: 'block' }}>{candidate.phone}</span>}</span></button>) }
          </div>}
        </>}
      </div> : <div className="field">
        <label className="field-label" htmlFor={`${idPrefix}-referrer-name`}>Nome de quem indicou</label>
        <input id={`${idPrefix}-referrer-name`} data-testid={`${idPrefix}-referrer-name`} className="field-input" value={value.referrerName ?? ''} onChange={event => onChange({ ...value, referrerName: event.target.value, referredByPatientId: null })} placeholder="Ex.: Fernanda Souza" style={{ minHeight: 44 }} />
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Não cria uma paciente automaticamente.</span>
      </div>}
      {!value.referredByPatientId && !value.referrerName?.trim() && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Se não souber quem indicou, pode salvar apenas como Indicação.</span>}
    </div>}

    {value.source && ACQUISITION_DETAIL_SOURCES.includes(value.source) && <div className="field">
      <label className="field-label" htmlFor={`${idPrefix}-detail`}>{detailLabel}</label>
      <input id={`${idPrefix}-detail`} data-testid={`${idPrefix}-detail`} className="field-input" value={value.sourceDetail ?? ''} onChange={event => onChange({ ...value, sourceDetail: event.target.value })} placeholder={value.source === 'partnership' ? 'Ex.: Clara Clippero Beauty Spa' : value.source === 'campaign' ? 'Ex.: Dia das Mães' : 'Ex.: Evento X'} style={{ minHeight: 44 }} />
    </div>}
  </div>;
}
''')

# New Patient
replace('src/pages/pacientes/NovaClienteDrawer.tsx',
"import { birthDateInputError, normalizePatientCreateData, patientCreateFriendlyError, validatePatientCreateData, type PatientCreateData } from '../../lib/patientInput';\n",
"import { birthDateInputError, normalizePatientCreateData, patientCreateFriendlyError, validatePatientCreateData, type PatientCreateData } from '../../lib/patientInput';\nimport { AcquisitionFields } from '../../components/patients/AcquisitionFields';\n")
replace('src/pages/pacientes/NovaClienteDrawer.tsx',
"  emergency_phone: null, convenio: null, notes: null, photo_url: null, start_date: null,\n",
"  emergency_phone: null, convenio: null, notes: null, photo_url: null, start_date: null,\n  acquisition_source: null, acquisition_source_detail: null, referred_by_patient_id: null, referrer_name: null,\n")
replace('src/pages/pacientes/NovaClienteDrawer.tsx',
"        <Field label=\"Instagram\"><input className=\"field-input\" placeholder=\"@usuario\" value={form.instagram??''} onChange={e=>set('instagram',e.target.value)}/></Field>\n",
"        <Field label=\"Instagram\"><input className=\"field-input\" placeholder=\"@usuario\" value={form.instagram??''} onChange={e=>set('instagram',e.target.value)}/></Field>\n        <div className=\"form-section-title\">Origem</div>\n        <div className=\"field field--full\"><AcquisitionFields idPrefix=\"new-patient-acquisition\" value={{ source: form.acquisition_source, sourceDetail: form.acquisition_source_detail, referredByPatientId: form.referred_by_patient_id, referrerName: form.referrer_name }} onChange={next=>setForm(current=>({ ...current, acquisition_source: next.source, acquisition_source_detail: next.sourceDetail, referred_by_patient_id: next.referredByPatientId, referrer_name: next.referrerName }))}/></div>\n")

# Edit Patient
replace('src/pages/pacientes/tabs/DadosTab.tsx',
"import { ageLabel, birthDateIsoToInput, formatBirthDateInput, parseBirthDateInput } from '../../../lib/dateUtils';\n",
"import { ageLabel, birthDateIsoToInput, formatBirthDateInput, parseBirthDateInput } from '../../../lib/dateUtils';\nimport { AcquisitionFields } from '../../../components/patients/AcquisitionFields';\nimport { normalizeAcquisitionDraft } from '../../../lib/acquisition';\n")
replace('src/pages/pacientes/tabs/DadosTab.tsx',
"      notes: patient.notes,\n",
"      notes: patient.notes,\n      acquisition_source: patient.acquisition_source,\n      acquisition_source_detail: patient.acquisition_source_detail,\n      referred_by_patient_id: patient.referred_by_patient_id,\n      referrer_name: patient.referrer_name,\n")
replace('src/pages/pacientes/tabs/DadosTab.tsx',
"      await onUpdate({ ...form, birth_date: birthDate });\n",
"      const acquisition = normalizeAcquisitionDraft({ source: form.acquisition_source ?? null, sourceDetail: form.acquisition_source_detail ?? null, referredByPatientId: form.referred_by_patient_id ?? null, referrerName: form.referrer_name ?? null });\n      await onUpdate({ ...form, birth_date: birthDate, acquisition_source: acquisition.source, acquisition_source_detail: acquisition.sourceDetail, referred_by_patient_id: acquisition.referredByPatientId, referrer_name: acquisition.referrerName });\n")
replace('src/pages/pacientes/tabs/DadosTab.tsx',
"          <div className=\"form-section-title\">Emergência</div>\n",
"          <div className=\"form-section-title\">Origem</div>\n          <div className=\"field field--full\"><AcquisitionFields idPrefix=\"edit-patient-acquisition\" excludePatientId={patient.id} value={{ source: form.acquisition_source ?? null, sourceDetail: form.acquisition_source_detail ?? null, referredByPatientId: form.referred_by_patient_id ?? null, referrerName: form.referrer_name ?? null }} onChange={next=>setForm(current=>({ ...current, acquisition_source: next.source, acquisition_source_detail: next.sourceDetail, referred_by_patient_id: next.referredByPatientId, referrer_name: next.referrerName }))}/></div>\n          <div className=\"form-section-title\">Emergência</div>\n")

# Patient360 acquisition/referrals card
write('src/components/patients/PatientAcquisitionCard.tsx', r'''import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Users } from 'lucide-react';
import type { Patient } from '../../types';
import { formatAcquisitionLabel } from '../../lib/acquisition';
import { supabase } from '../../lib/supabase';

type ReferredPatient = { id: string; name: string; archived: boolean; has_attendance: boolean };
type Summary = {
  referrer: { id: string; name: string; archived: boolean } | null;
  referred_count: number;
  referred_attended_count: number;
  referred_patients: ReferredPatient[];
};

export function PatientAcquisitionCard({ patient }: { patient: Patient }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    void supabase.rpc('get_patient_referral_summary_v1', { p_patient_id: patient.id }).then(({ data, error }) => {
      if (error) { console.warn('[patient360:acquisition]', error); return; }
      if (alive) setSummary(data as Summary);
    });
    return () => { alive = false; };
  }, [patient.id, patient.referred_by_patient_id]);

  const referrerLabel = summary?.referrer?.name ?? patient.referrer_name ?? null;
  const origin = formatAcquisitionLabel(patient.acquisition_source, patient.acquisition_source_detail, referrerLabel);
  const manualReferral = patient.acquisition_source === 'referral' && !patient.referred_by_patient_id && Boolean(patient.referrer_name);

  return <div className="card" data-testid="patient-acquisition-card" style={{ padding: 14 }}>
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="section-title" style={{ marginBottom: 5 }}>Origem</div>
        <strong data-testid="patient-acquisition-label">{origin}</strong>
        {manualReferral && <div className="page-sub" style={{ marginTop: 2 }}>Pessoa indicadora não cadastrada.</div>}
      </div>
      {(summary?.referred_count ?? 0) > 0 && <div style={{ textAlign: 'right' }}><div className="section-title" style={{ marginBottom: 5 }}>Indicações</div><strong>{summary?.referred_count} paciente{summary?.referred_count === 1 ? '' : 's'}</strong></div>}
    </div>
    {(summary?.referred_count ?? 0) > 0 && <>
      <button type="button" className="btn btn--ghost btn--sm" style={{ marginTop: 8 }} onClick={() => setOpen(value => !value)}><Users size={14} /> {open ? 'Ocultar' : 'Ver quem indicou'} {open ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}</button>
      {open && <div data-testid="patient-referrals-list" style={{ display: 'grid', gap: 6, marginTop: 8 }}>
        <div className="page-sub">{summary?.referred_attended_count ?? 0} com atendimento registrado.</div>
        {summary?.referred_patients.map(item => <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '8px 0', borderTop: '1px solid var(--border)' }}><span>{item.name}{item.archived ? ' (arquivada)' : ''}</span><span className="page-sub">{item.has_attendance ? 'Com atendimento' : 'Sem atendimento'}</span></div>)}
      </div>}
    </>}
  </div>;
}
''')
replace('src/pages/pacientes/PacienteView.tsx',
"import { PatientWaitlistCard } from '../agenda/AgendaRecoveryUI';\n",
"import { PatientWaitlistCard } from '../agenda/AgendaRecoveryUI';\nimport { PatientAcquisitionCard } from '../../components/patients/PatientAcquisitionCard';\n")
replace('src/pages/pacientes/PacienteView.tsx',
"{tab==='overview'?<div style={{display:'grid',gap:12}}><OverviewTab patientId={patient.id}",
"{tab==='overview'?<div style={{display:'grid',gap:12}}><PatientAcquisitionCard patient={patient}/><OverviewTab patientId={patient.id}")

# -----------------------------------------------------------------------------
# CRM: same taxonomy + referral capture before conversion
# -----------------------------------------------------------------------------
replace('src/hooks/useCrm.ts',
"  source: CrmSource;\n  source_detail: string | null;\n",
"  source: CrmSource | null;\n  source_detail: string | null;\n  referred_by_patient_id: string | null;\n  referrer_name: string | null;\n  referrer_patient_name: string | null;\n")
replace('src/hooks/useCrm.ts',
"  source: CrmSource;\n  sourceDetail?: string | null;\n",
"  source: CrmSource | null;\n  sourceDetail?: string | null;\n  referredByPatientId?: string | null;\n  referrerName?: string | null;\n")
replace('src/hooks/useCrm.ts',
"    const { data, error: rpcError } = await supabase.rpc('create_crm_lead_v1', {\n",
"    const { data, error: rpcError } = await supabase.rpc('create_crm_lead_v2', {\n")
replace('src/hooks/useCrm.ts',
"      p_source_detail: input.sourceDetail?.trim() || null,\n",
"      p_source_detail: input.sourceDetail?.trim() || null,\n      p_referred_by_patient_id: input.referredByPatientId ?? null,\n      p_referrer_name: input.referrerName?.trim() || null,\n")

replace('src/pages/crm/CrmPage.tsx',
"import { clinicDateIso } from '../../lib/agendaTime';\n",
"import { clinicDateIso } from '../../lib/agendaTime';\nimport { AcquisitionFields } from '../../components/patients/AcquisitionFields';\nimport { emptyAcquisitionDraft, formatAcquisitionLabel, type AcquisitionDraft } from '../../lib/acquisition';\n")
replace('src/pages/crm/CrmPage.tsx',
"          <span>{CRM_SOURCE_LABEL[card.source]}</span>\n",
"          <span>{formatAcquisitionLabel(card.source, card.source_detail, card.referrer_patient_name ?? card.referrer_name)}</span>\n")
replace('src/pages/crm/CrmPage.tsx',
"  const [source, setSource] = useState<CrmSource>(patient ? 'existing_patient' : 'whatsapp');\n  const [sourceDetail, setSourceDetail] = useState('');\n",
"  const [acquisition, setAcquisition] = useState<AcquisitionDraft>(() => ({ ...emptyAcquisitionDraft(), source: patient ? 'existing_patient' : null }));\n")
replace('src/pages/crm/CrmPage.tsx',
"  const dirty = Boolean((!patient && (name.trim() || phone?.trim() || email?.trim() || sourceDetail.trim())) || form.title.trim() || form.value || form.expectedClose || form.note.trim() || form.interests.length);\n",
"  const dirty = Boolean((!patient && (name.trim() || phone?.trim() || email?.trim() || acquisition.source || acquisition.sourceDetail?.trim() || acquisition.referredByPatientId || acquisition.referrerName?.trim())) || form.title.trim() || form.value || form.expectedClose || form.note.trim() || form.interests.length);\n")
replace('src/pages/crm/CrmPage.tsx',
"      await crm.createLead({ ...opportunityInput(), name, phone, email, source, sourceDetail });\n",
"      await crm.createLead({ ...opportunityInput(), name, phone, email, source: acquisition.source, sourceDetail: acquisition.sourceDetail, referredByPatientId: acquisition.referredByPatientId, referrerName: acquisition.referrerName });\n")
replace('src/pages/crm/CrmPage.tsx',
"<div><label className=\"field-label\">Origem</label><select className=\"field-select\" value={source} onChange={event => setSource(event.target.value as CrmSource)}>{CRM_SOURCE_KEYS.map(key => <option value={key} key={key}>{CRM_SOURCE_LABEL[key]}</option>)}</select></div><div><label className=\"field-label\">Detalhe da origem</label><input className=\"field-input\" value={sourceDetail} onChange={event => setSourceDetail(event.target.value)} placeholder=\"Ex.: Maria / Dia das Mães\" /></div>",
"<div className=\"crm-form-span\"><AcquisitionFields idPrefix=\"crm-lead-acquisition\" value={acquisition} onChange={setAcquisition}/></div>")
replace('src/pages/crm/CrmPage.tsx',
"<span>{CRM_SOURCE_LABEL[card.source]}{card.source_detail ? ` · ${card.source_detail}` : ''}</span>",
"<span>{formatAcquisitionLabel(card.source, card.source_detail, card.referrer_patient_name ?? card.referrer_name)}</span>")
replace('src/pages/crm/CrmPage.tsx',
"<div className=\"page-header\"><div><h1 className=\"page-title\">CRM</h1><p className=\"page-sub\">Leads, oportunidades e follow-ups comerciais</p></div><button className=\"btn btn--primary btn--md\" onClick={() => { setPatientSeed(null); navigate('/crm', { replace: true }); setNewOpen(true); }}><Plus size={16} /> Novo lead</button></div>",
"<div className=\"page-header\"><div><h1 className=\"page-title\">CRM</h1><p className=\"page-sub\">Leads, oportunidades e follow-ups comerciais</p></div><div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button className=\"btn btn--ghost btn--md\" onClick={() => navigate('/crm/aquisicao')}>Aquisição & Indicações</button><button className=\"btn btn--primary btn--md\" onClick={() => { setPatientSeed(null); navigate('/crm', { replace: true }); setNewOpen(true); }}><Plus size={16} /> Novo lead</button></div></div>")

# -----------------------------------------------------------------------------
# Acquisition report read-model + page
# -----------------------------------------------------------------------------
write('src/hooks/useAcquisition.ts', r'''import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { AcquisitionSource } from '../lib/acquisition';

type SourceRow = {
  source: AcquisitionSource | null;
  label: string;
  registrations: number;
  attended_patients: number;
  procedures: number;
  production_value: number;
};

type ReferrerRow = {
  patient_id: string;
  name: string;
  referred_registered: number;
  referred_with_attendance: number;
};

export type AcquisitionSummary = {
  period: { start_date: string; end_date_exclusive: string; timezone: string };
  sources: SourceRow[];
  top_referrers: ReferrerRow[];
};

export function useAcquisition(startDate: string, endDateExclusive: string) {
  const [data, setData] = useState<AcquisitionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data: result, error: rpcError } = await supabase.rpc('get_acquisition_summary_v1', { p_start_date: startDate, p_end_date_exclusive: endDateExclusive });
      if (rpcError) throw rpcError;
      setData(result as AcquisitionSummary);
    } catch (err) {
      console.error('[acquisition:summary]', err);
      setError('Não foi possível carregar a visão de aquisição.');
      setData(null);
    } finally { setLoading(false); }
  }, [endDateExclusive, startDate]);

  useEffect(() => { void load(); }, [load]);
  return { data, loading, error, refresh: load };
}
''')

write('src/pages/crm/AcquisitionPage.tsx', r'''import { useMemo, useState } from 'react';
import { ArrowLeft, RefreshCw, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { addIsoDays, clinicDateIso } from '../../lib/agendaTime';
import { useAcquisition } from '../../hooks/useAcquisition';

const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);

export function AcquisitionPage() {
  const navigate = useNavigate();
  const today = clinicDateIso();
  const [startDate, setStartDate] = useState(monthStart(today));
  const [endDate, setEndDate] = useState(today);
  const endExclusive = useMemo(() => addIsoDays(endDate, 1), [endDate]);
  const { data, loading, error, refresh } = useAcquisition(startDate, endExclusive);
  const totals = useMemo(() => (data?.sources ?? []).reduce((acc, row) => ({ registrations: acc.registrations + Number(row.registrations), attended: acc.attended + Number(row.attended_patients), procedures: acc.procedures + Number(row.procedures), value: acc.value + Number(row.production_value) }), { registrations: 0, attended: 0, procedures: 0, value: 0 }), [data]);

  return <div className="page" data-testid="acquisition-page">
    <div className="page-header"><div><button type="button" className="btn btn--ghost btn--sm" onClick={() => navigate('/crm')}><ArrowLeft size={15}/> CRM</button><h1 className="page-title" style={{ marginTop: 6 }}>Origem das pacientes</h1><p className="page-sub">Aquisição e indicações, sem confundir origem com canal ou pagamento.</p></div><button className="btn btn--ghost btn--md" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15}/> Atualizar</button></div>

    <div className="card" style={{ padding: 12, marginBottom: 12 }}><div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end' }}><div className="field"><label className="field-label">De</label><input className="field-input" type="date" value={startDate} max={endDate} onChange={event => setStartDate(event.target.value)} /></div><div className="field"><label className="field-label">Até</label><input className="field-input" type="date" value={endDate} min={startDate} onChange={event => setEndDate(event.target.value)} /></div><div className="page-sub">Cadastros usam <strong>data de cadastro</strong>. Produção usa <strong>data do procedimento realizado</strong>. Timezone: America/Sao_Paulo.</div></div></div>

    {loading ? <div className="card" style={{ padding: 18 }}>Carregando aquisição…</div> : error ? <div className="empty-state"><p>{error}</p><button className="btn btn--secondary btn--sm" onClick={() => void refresh()}>Tentar novamente</button></div> : <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10, marginBottom: 12 }}>
        <div className="card" style={{ padding: 14 }}><div className="page-sub">Cadastros no período</div><strong style={{ fontSize: 24 }}>{totals.registrations}</strong></div>
        <div className="card" style={{ padding: 14 }}><div className="page-sub">Pacientes com atendimento no período</div><strong style={{ fontSize: 24 }}>{totals.attended}</strong></div>
        <div className="card" style={{ padding: 14 }}><div className="page-sub">Procedimentos realizados</div><strong style={{ fontSize: 24 }}>{totals.procedures}</strong></div>
        <div className="card" style={{ padding: 14 }}><div className="page-sub">Valor realizado</div><strong style={{ fontSize: 20 }}>{money(totals.value)}</strong><div className="page-sub">Soma do valor dos procedimentos realizados por pacientes com essas origens.</div></div>
      </div>

      <div className="card" style={{ overflowX: 'auto', marginBottom: 12 }}><div style={{ padding: 14, borderBottom: '1px solid var(--border)' }}><strong>Por origem</strong><div className="page-sub">“Não informado” permanece visível para medir qualidade do dado histórico.</div></div><table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}><thead><tr><th style={{ textAlign: 'left', padding: 10 }}>Origem</th><th style={{ textAlign: 'right', padding: 10 }}>Cadastros</th><th style={{ textAlign: 'right', padding: 10 }}>Pacientes com atendimento</th><th style={{ textAlign: 'right', padding: 10 }}>Procedimentos</th><th style={{ textAlign: 'right', padding: 10 }}>Valor realizado</th></tr></thead><tbody>{data?.sources.map(row => <tr key={row.source ?? 'not_informed'} data-testid={`acquisition-row-${row.source ?? 'not-informed'}`} style={{ borderTop: '1px solid var(--border)' }}><td style={{ padding: 10 }}><strong>{row.label}</strong></td><td style={{ padding: 10, textAlign: 'right' }}>{row.registrations}</td><td style={{ padding: 10, textAlign: 'right' }}>{row.attended_patients}</td><td style={{ padding: 10, textAlign: 'right' }}>{row.procedures}</td><td style={{ padding: 10, textAlign: 'right' }}>{money(row.production_value)}</td></tr>)}</tbody></table></div>

      <div className="card" style={{ padding: 14 }}><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Users size={17}/><strong>Pacientes que mais indicaram</strong></div><div className="page-sub" style={{ marginTop: 3 }}>Somente vínculos explícitos entre Patients; nomes digitados manualmente não são convertidos em Patient.</div>{(data?.top_referrers.length ?? 0) === 0 ? <div className="empty-state" style={{ padding: '18px 0 4px' }}>Ainda não há indicações canônicas no período.</div> : <div style={{ display: 'grid', gap: 4, marginTop: 10 }}>{data?.top_referrers.map((item, index) => <div key={item.patient_id} style={{ display: 'grid', gridTemplateColumns: '28px minmax(0,1fr) auto', gap: 8, alignItems: 'center', padding: '9px 0', borderTop: '1px solid var(--border)' }}><span className="page-sub">{index + 1}</span><strong>{item.name}</strong><span className="page-sub">{item.referred_registered} indicada{item.referred_registered === 1 ? '' : 's'} cadastrada{item.referred_registered === 1 ? '' : 's'} · {item.referred_with_attendance} com atendimento</span></div>)}</div>}</div>
    </>}
  </div>;
}
''')

# Route (no new top-level navigation item; acquisition lives under CRM)
replace('src/AppRoutesV2.tsx',
"const HubHealthPage=lazy(()=>import('./pages/saude/HubHealthPage').then(m=>({default:m.HubHealthPage})));\n",
"const HubHealthPage=lazy(()=>import('./pages/saude/HubHealthPage').then(m=>({default:m.HubHealthPage})));const AcquisitionPage=lazy(()=>import('./pages/crm/AcquisitionPage').then(m=>({default:m.AcquisitionPage})));\n")
replace('src/AppRoutesV2.tsx',
"<Route path=\"crm\" element={<CrmPage/>}/><Route path=\"crm/propostas-em-aberto\"",
"<Route path=\"crm\" element={<CrmPage/>}/><Route path=\"crm/aquisicao\" element={<AcquisitionPage/>}/><Route path=\"crm/propostas-em-aberto\"")

# -----------------------------------------------------------------------------
# Database migration
# -----------------------------------------------------------------------------
write('supabase/migrations/20260818184500_patient_acquisition_referrals_v1.sql', r'''-- Hub Giulia 4.2 — Origem de Pacientes & Indicações
-- Aquisição factual, indicação explícita, preservação Contact -> Patient e read models.

-- Canonical acquisition taxonomy used by both Patient and new CRM writes:
-- instagram, referral, google, partnership, existing_patient, campaign, other.
-- `contacts.source='whatsapp'` remains DB-compatible only as a legacy value because
-- previous CRM versions used a communication channel as source. New UI/RPC v2 do not write it.

alter table public.patients
  add column if not exists acquisition_source text,
  add column if not exists acquisition_source_detail text,
  add column if not exists referred_by_patient_id uuid,
  add column if not exists referrer_name text;

alter table public.contacts
  add column if not exists referred_by_patient_id uuid,
  add column if not exists referrer_name text;

-- Unknown CRM origin must be representable without inventing `other`.
alter table public.contacts alter column source drop not null;
alter table public.contacts alter column source drop default;

alter table public.patients drop constraint if exists patients_acquisition_source_check;
alter table public.patients add constraint patients_acquisition_source_check check (
  acquisition_source is null or acquisition_source = any (array[
    'instagram'::text, 'referral'::text, 'google'::text, 'partnership'::text,
    'existing_patient'::text, 'campaign'::text, 'other'::text
  ])
);

alter table public.patients drop constraint if exists patients_acquisition_referral_semantics_check;
alter table public.patients add constraint patients_acquisition_referral_semantics_check check (
  acquisition_source = 'referral'::text
  or (acquisition_source is distinct from 'referral'::text and referred_by_patient_id is null and referrer_name is null)
);

alter table public.patients drop constraint if exists patients_acquisition_referrer_exclusive_check;
alter table public.patients add constraint patients_acquisition_referrer_exclusive_check check (
  referred_by_patient_id is null or referrer_name is null
);

alter table public.patients drop constraint if exists patients_acquisition_self_referral_check;
alter table public.patients add constraint patients_acquisition_self_referral_check check (
  referred_by_patient_id is null or referred_by_patient_id <> id
);

alter table public.patients drop constraint if exists patients_acquisition_referrer_name_check;
alter table public.patients add constraint patients_acquisition_referrer_name_check check (
  referrer_name is null or nullif(btrim(referrer_name), '') is not null
);

alter table public.patients drop constraint if exists patients_acquisition_detail_semantics_check;
alter table public.patients add constraint patients_acquisition_detail_semantics_check check (
  acquisition_source = any (array['partnership'::text, 'campaign'::text, 'other'::text])
  or acquisition_source_detail is null
);

alter table public.patients drop constraint if exists patients_acquisition_referrer_owner_fkey;
alter table public.patients add constraint patients_acquisition_referrer_owner_fkey
  foreign key (referred_by_patient_id, user_id)
  references public.patients(id, user_id);

-- Preserve the one known legacy CRM source while admitting the canonical partnership source.
alter table public.contacts drop constraint if exists contacts_source_check;
alter table public.contacts add constraint contacts_source_check check (
  source is null or source = any (array[
    'instagram'::text, 'whatsapp'::text, 'referral'::text, 'google'::text,
    'partnership'::text, 'existing_patient'::text, 'campaign'::text, 'other'::text
  ])
);

alter table public.contacts drop constraint if exists contacts_referral_semantics_check;
alter table public.contacts add constraint contacts_referral_semantics_check check (
  source = 'referral'::text
  or (source is distinct from 'referral'::text and referred_by_patient_id is null and referrer_name is null)
);

alter table public.contacts drop constraint if exists contacts_referrer_exclusive_check;
alter table public.contacts add constraint contacts_referrer_exclusive_check check (
  referred_by_patient_id is null or referrer_name is null
);

alter table public.contacts drop constraint if exists contacts_referrer_name_check;
alter table public.contacts add constraint contacts_referrer_name_check check (
  referrer_name is null or nullif(btrim(referrer_name), '') is not null
);

alter table public.contacts drop constraint if exists contacts_referrer_owner_fkey;
alter table public.contacts add constraint contacts_referrer_owner_fkey
  foreign key (referred_by_patient_id, user_id)
  references public.patients(id, user_id);

create index if not exists patients_user_acquisition_created_idx
  on public.patients(user_id, acquisition_source, created_at desc);
create index if not exists patients_user_referrer_idx
  on public.patients(user_id, referred_by_patient_id)
  where referred_by_patient_id is not null;
create index if not exists contacts_user_referrer_idx
  on public.contacts(user_id, referred_by_patient_id)
  where referred_by_patient_id is not null;

-- New atomic CRM write contract. v1 remains intact for pre-deploy compatibility.
create or replace function public.create_crm_lead_v2(
  p_name text,
  p_phone text default null,
  p_email text default null,
  p_instagram text default null,
  p_source text default null,
  p_source_detail text default null,
  p_referred_by_patient_id uuid default null,
  p_referrer_name text default null,
  p_title text default null,
  p_value numeric default null,
  p_expected_close date default null,
  p_interests jsonb default '[]'::jsonb,
  p_note text default null,
  p_idempotency_key uuid default gen_random_uuid()
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_contact_id uuid;
  v_deal_id uuid;
  v_interest jsonb;
  v_service_id uuid;
  v_service_name text;
  v_label text;
  v_source text := nullif(btrim(p_source), '');
  v_source_detail text := nullif(btrim(p_source_detail), '');
  v_referrer_id uuid := p_referred_by_patient_id;
  v_referrer_name text := nullif(btrim(p_referrer_name), '');
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if nullif(btrim(p_name), '') is null then raise exception 'CRM_NAME_REQUIRED' using errcode='23514'; end if;
  if p_idempotency_key is null then raise exception 'CRM_IDEMPOTENCY_REQUIRED' using errcode='23514'; end if;
  if v_source is not null and not (v_source = any(array['instagram','referral','google','partnership','existing_patient','campaign','other'])) then
    raise exception 'CRM_ACQUISITION_SOURCE_INVALID' using errcode='23514';
  end if;
  if v_source is distinct from 'referral' then
    v_referrer_id := null; v_referrer_name := null;
  elsif v_referrer_id is not null then
    v_referrer_name := null;
  end if;
  if v_source is null or not (v_source = any(array['partnership','campaign','other'])) then v_source_detail := null; end if;
  if v_referrer_id is not null and not exists(select 1 from public.patients p where p.id=v_referrer_id and p.user_id=v_user_id) then
    raise exception 'CRM_REFERRER_NOT_FOUND' using errcode='23503';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_idempotency_key::text, 0));
  select d.contact_id, d.id into v_contact_id, v_deal_id from public.deals d where d.user_id=v_user_id and d.idempotency_key=p_idempotency_key;
  if v_deal_id is not null then return jsonb_build_object('contact_id',v_contact_id,'deal_id',v_deal_id,'reused',true); end if;

  insert into public.contacts(user_id,name,phone,email,instagram,source,source_detail,referred_by_patient_id,referrer_name)
  values(v_user_id,btrim(p_name),nullif(btrim(p_phone),''),nullif(lower(btrim(p_email)),''),nullif(btrim(p_instagram),''),v_source,v_source_detail,v_referrer_id,v_referrer_name)
  returning id into v_contact_id;

  insert into public.deals(user_id,contact_id,title,value,stage,expected_close,idempotency_key)
  values(v_user_id,v_contact_id,coalesce(nullif(btrim(p_title),''),'Oportunidade · '||btrim(p_name)),p_value,'new',p_expected_close,p_idempotency_key)
  returning id into v_deal_id;

  if jsonb_typeof(coalesce(p_interests,'[]'::jsonb)) <> 'array' then raise exception 'CRM_INTERESTS_INVALID' using errcode='22023'; end if;
  for v_interest in select value from jsonb_array_elements(coalesce(p_interests,'[]'::jsonb)) loop
    v_service_id := nullif(v_interest->>'service_id','')::uuid;
    v_label := nullif(btrim(v_interest->>'label'),'');
    v_service_name := null;
    if v_service_id is not null then
      select s.name into v_service_name from public.services s where s.id=v_service_id and s.user_id=v_user_id;
      if v_service_name is null then raise exception 'CRM_SERVICE_NOT_FOUND' using errcode='23503'; end if;
    end if;
    if coalesce(v_label,v_service_name) is not null then
      insert into public.crm_deal_interests(user_id,deal_id,service_id,label_snapshot) values(v_user_id,v_deal_id,v_service_id,coalesce(v_label,v_service_name));
    end if;
  end loop;
  if nullif(btrim(p_note),'') is not null then
    insert into public.crm_activities(user_id,contact_id,deal_id,activity_type,note,actor_user_id) values(v_user_id,v_contact_id,v_deal_id,'note',btrim(p_note),v_user_id);
  end if;
  return jsonb_build_object('contact_id',v_contact_id,'deal_id',v_deal_id,'reused',false);
end;
$$;

revoke all on function public.create_crm_lead_v2(text,text,text,text,text,text,uuid,text,text,numeric,date,jsonb,text,uuid) from public, anon;
grant execute on function public.create_crm_lead_v2(text,text,text,text,text,text,uuid,text,text,numeric,date,jsonb,text,uuid) to authenticated;

-- Preserve acquisition only when conversion creates a brand-new Patient.
create or replace function public.convert_crm_contact_to_patient_v1(p_contact_id uuid, p_existing_patient_id uuid default null)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_contact public.contacts%rowtype;
  v_patient_id uuid;
  v_acquisition_source text;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  select * into v_contact from public.contacts c where c.id=p_contact_id and c.user_id=v_user_id for update;
  if not found then raise exception 'CRM_CONTACT_NOT_FOUND' using errcode='P0002'; end if;
  if v_contact.patient_id is not null then return v_contact.patient_id; end if;

  if p_existing_patient_id is not null then
    select p.id into v_patient_id from public.patients p where p.id=p_existing_patient_id and p.user_id=v_user_id;
    if v_patient_id is null then raise exception 'CRM_PATIENT_NOT_FOUND' using errcode='P0002'; end if;
  else
    -- `whatsapp` is a legacy channel value, not a factual acquisition source; never invent a mapping.
    v_acquisition_source := case when v_contact.source = any(array['instagram','referral','google','partnership','existing_patient','campaign','other']) then v_contact.source else null end;
    insert into public.patients(
      user_id,name,phone,email,instagram,
      acquisition_source,acquisition_source_detail,referred_by_patient_id,referrer_name
    ) values(
      v_user_id,v_contact.name,v_contact.phone,v_contact.email,v_contact.instagram,
      v_acquisition_source,
      case when v_acquisition_source = any(array['partnership','campaign','other']) then v_contact.source_detail else null end,
      case when v_acquisition_source='referral' then v_contact.referred_by_patient_id else null end,
      case when v_acquisition_source='referral' and v_contact.referred_by_patient_id is null then v_contact.referrer_name else null end
    ) returning id into v_patient_id;
  end if;

  update public.contacts set patient_id=v_patient_id where id=p_contact_id and user_id=v_user_id;
  insert into public.crm_activities(user_id,contact_id,activity_type,note,metadata,actor_user_id)
  values(v_user_id,p_contact_id,'patient_linked',case when p_existing_patient_id is null then 'Contato convertido em paciente.' else 'Contato vinculado a paciente existente.' end,jsonb_build_object('patient_id',v_patient_id,'created_patient',p_existing_patient_id is null),v_user_id);
  return v_patient_id;
end;
$$;

revoke all on function public.convert_crm_contact_to_patient_v1(uuid,uuid) from public, anon;
grant execute on function public.convert_crm_contact_to_patient_v1(uuid,uuid) to authenticated;

-- Append referral data to the existing CRM read model without changing existing columns.
create or replace view public.crm_pipeline_v
with (security_invoker=true)
as
select
  d.id as deal_id, d.user_id, d.contact_id, d.title, d.value as estimated_value, d.stage, d.expected_close,
  d.lost_reason, d.lost_reason_detail, d.won_at, d.lost_at, d.closed_at, d.created_at as deal_created_at, d.updated_at as deal_updated_at,
  c.patient_id, c.name as contact_name, c.phone, c.email, c.instagram, c.source, c.source_detail, c.archived_at as contact_archived_at,
  pat.name as patient_name,
  coalesce(i.interests,'[]'::jsonb) as interests,
  f.next_followup_on, a.last_activity_at,
  q.proposal_id, q.version_id as proposal_version_id, q.title as proposal_title, q.version_number as proposal_version_number,
  q.status as proposal_status, q.effective_status as proposal_effective_status, q.total_value as proposal_total_value,
  q.valid_until as proposal_valid_until, q.sent_at as proposal_sent_at,
  c.referred_by_patient_id, c.referrer_name, referrer.name as referrer_patient_name
from public.deals d
join public.contacts c on c.id=d.contact_id and c.user_id=d.user_id
left join public.patients pat on pat.id=c.patient_id and pat.user_id=c.user_id
left join public.patients referrer on referrer.id=c.referred_by_patient_id and referrer.user_id=c.user_id
left join lateral (
  select jsonb_agg(jsonb_build_object('id',x.id,'service_id',x.service_id,'label',x.label_snapshot) order by x.created_at,x.id) as interests
  from public.crm_deal_interests x where x.user_id=d.user_id and x.deal_id=d.id
) i on true
left join lateral (
  select min(fu.due_on) as next_followup_on from public.crm_followups fu where fu.user_id=d.user_id and fu.deal_id=d.id and fu.status='open'
) f on true
left join lateral (
  select max(ac.occurred_at) as last_activity_at from public.crm_activities ac where ac.user_id=d.user_id and ac.deal_id=d.id
) a on true
left join lateral (
  select s.* from public.treatment_proposal_summary_v s where s.user_id=d.user_id and s.deal_id=d.id order by s.proposal_updated_at desc,s.proposal_id desc limit 1
) q on true;

grant select on public.crm_pipeline_v to authenticated;

create or replace function public.get_patient_referral_summary_v1(p_patient_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_patient public.patients%rowtype;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  select * into v_patient from public.patients p where p.id=p_patient_id and p.user_id=v_user_id;
  if not found then raise exception 'PATIENT_NOT_FOUND' using errcode='P0002'; end if;
  return jsonb_build_object(
    'referrer', (select case when r.id is null then null else jsonb_build_object('id',r.id,'name',r.name,'archived',r.archived_at is not null) end from (select 1) x left join public.patients r on r.id=v_patient.referred_by_patient_id and r.user_id=v_user_id),
    'referred_count', (select count(*)::integer from public.patients p where p.user_id=v_user_id and p.referred_by_patient_id=p_patient_id),
    'referred_attended_count', (select count(*)::integer from public.patients p where p.user_id=v_user_id and p.referred_by_patient_id=p_patient_id and exists(select 1 from public.procedures pr where pr.user_id=v_user_id and pr.patient_id=p.id)),
    'referred_patients', coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'archived',p.archived_at is not null,'has_attendance',exists(select 1 from public.procedures pr where pr.user_id=v_user_id and pr.patient_id=p.id)) order by p.created_at desc,p.id) from public.patients p where p.user_id=v_user_id and p.referred_by_patient_id=p_patient_id),'[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_patient_referral_summary_v1(uuid) from public, anon;
grant execute on function public.get_patient_referral_summary_v1(uuid) to authenticated;

create or replace function public.get_acquisition_summary_v1(p_start_date date, p_end_date_exclusive date)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_start timestamptz;
  v_end timestamptz;
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if p_start_date is null or p_end_date_exclusive is null or p_start_date >= p_end_date_exclusive then raise exception 'ACQUISITION_PERIOD_INVALID' using errcode='22023'; end if;
  if p_end_date_exclusive - p_start_date > 366 then raise exception 'ACQUISITION_PERIOD_TOO_LARGE' using errcode='22023'; end if;
  v_start := p_start_date::timestamp at time zone 'America/Sao_Paulo';
  v_end := p_end_date_exclusive::timestamp at time zone 'America/Sao_Paulo';

  return (
    with source_order(source,label,ord) as (values
      ('referral'::text,'Indicação'::text,1),
      ('instagram'::text,'Instagram'::text,2),
      ('google'::text,'Google'::text,3),
      ('partnership'::text,'Parceria'::text,4),
      ('existing_patient'::text,'Já conhecia / paciente antiga'::text,5),
      ('campaign'::text,'Campanha'::text,6),
      ('other'::text,'Outro'::text,7),
      (null::text,'Não informado'::text,99)
    ), registrations as (
      select p.acquisition_source as source, count(*)::integer as registrations
      from public.patients p
      where p.user_id=v_user_id and p.created_at>=v_start and p.created_at<v_end
      group by p.acquisition_source
    ), production as (
      select pat.acquisition_source as source,
        count(distinct pr.patient_id)::integer as attended_patients,
        count(distinct pr.id)::integer as procedures,
        coalesce(sum(pi.final_price),0)::numeric(14,2) as production_value
      from public.procedures pr
      join public.patients pat on pat.id=pr.patient_id and pat.user_id=pr.user_id
      left join public.procedure_items pi on pi.procedure_id=pr.id and pi.user_id=pr.user_id
      where pr.user_id=v_user_id and pr.performed_at>=v_start and pr.performed_at<v_end
      group by pat.acquisition_source
    ), source_rows as (
      select s.source,s.label,s.ord,coalesce(r.registrations,0)::integer as registrations,
        coalesce(p.attended_patients,0)::integer as attended_patients,
        coalesce(p.procedures,0)::integer as procedures,
        coalesce(p.production_value,0)::numeric(14,2) as production_value
      from source_order s
      left join registrations r on r.source is not distinct from s.source
      left join production p on p.source is not distinct from s.source
    ), top_referrers as (
      select ref.id as patient_id,ref.name,
        count(distinct child.id) filter(where child.created_at>=v_start and child.created_at<v_end)::integer as referred_registered,
        count(distinct child.id) filter(where exists(select 1 from public.procedures pr where pr.user_id=v_user_id and pr.patient_id=child.id and pr.performed_at>=v_start and pr.performed_at<v_end))::integer as referred_with_attendance
      from public.patients child
      join public.patients ref on ref.id=child.referred_by_patient_id and ref.user_id=child.user_id
      where child.user_id=v_user_id and child.acquisition_source='referral'
      group by ref.id,ref.name
      having count(distinct child.id) filter(where child.created_at>=v_start and child.created_at<v_end)>0
         or count(distinct child.id) filter(where exists(select 1 from public.procedures pr where pr.user_id=v_user_id and pr.patient_id=child.id and pr.performed_at>=v_start and pr.performed_at<v_end))>0
      order by referred_registered desc,referred_with_attendance desc,ref.name
      limit 10
    )
    select jsonb_build_object(
      'period',jsonb_build_object('start_date',p_start_date,'end_date_exclusive',p_end_date_exclusive,'timezone','America/Sao_Paulo'),
      'sources',(select jsonb_agg(jsonb_build_object('source',source,'label',label,'registrations',registrations,'attended_patients',attended_patients,'procedures',procedures,'production_value',production_value) order by ord) from source_rows),
      'top_referrers',coalesce((select jsonb_agg(jsonb_build_object('patient_id',patient_id,'name',name,'referred_registered',referred_registered,'referred_with_attendance',referred_with_attendance) order by referred_registered desc,referred_with_attendance desc,name) from top_referrers),'[]'::jsonb)
    )
  );
end;
$$;
revoke all on function public.get_acquisition_summary_v1(date,date) from public, anon;
grant execute on function public.get_acquisition_summary_v1(date,date) to authenticated;

comment on column public.patients.acquisition_source is 'Principal factual acquisition source; nullable for unknown/legacy history.';
comment on column public.patients.referred_by_patient_id is 'Explicit canonical Patient who referred this Patient; same-tenant FK, no fuzzy matching.';
comment on function public.get_acquisition_summary_v1(date,date) is 'Hub Giulia 4.2 acquisition read model. Registration uses patients.created_at; production uses procedures.performed_at and procedure_items.final_price. Not revenue attribution.';
''')

# -----------------------------------------------------------------------------
# Unit tests
# -----------------------------------------------------------------------------
write('src/lib/acquisition.test.ts', r'''import { describe, expect, it } from 'vitest';
import { ACQUISITION_SOURCE_KEYS, formatAcquisitionLabel, normalizeAcquisitionDraft } from './acquisition';

describe('acquisition domain', () => {
  it('uses one canonical source taxonomy without communication channels', () => {
    expect(ACQUISITION_SOURCE_KEYS).toEqual(['instagram','referral','google','partnership','existing_patient','campaign','other']);
    expect(ACQUISITION_SOURCE_KEYS).not.toContain('whatsapp');
  });

  it('keeps referral input while the form switches source, but cleans persistence semantics', () => {
    const cleaned = normalizeAcquisitionDraft({ source: 'instagram', sourceDetail: 'ignored', referredByPatientId: 'patient-1', referrerName: 'Maria' });
    expect(cleaned).toEqual({ source: 'instagram', sourceDetail: null, referredByPatientId: null, referrerName: null });
  });

  it('prefers canonical referrer over manual text', () => {
    expect(normalizeAcquisitionDraft({ source: 'referral', sourceDetail: 'x', referredByPatientId: 'patient-1', referrerName: 'Maria' })).toEqual({ source: 'referral', sourceDetail: null, referredByPatientId: 'patient-1', referrerName: null });
  });

  it('supports referral without knowing who referred', () => {
    expect(normalizeAcquisitionDraft({ source: 'referral', sourceDetail: null, referredByPatientId: null, referrerName: null }).source).toBe('referral');
  });

  it('formats null, referral and partnership factually', () => {
    expect(formatAcquisitionLabel(null)).toBe('Não informada');
    expect(formatAcquisitionLabel('referral', null, 'Maria Silva')).toBe('Indicação — Maria Silva');
    expect(formatAcquisitionLabel('partnership', 'Clara Clippero')).toBe('Parceria — Clara Clippero');
  });
});
''')

# -----------------------------------------------------------------------------
# E2E: DB invariants + browser UX + responsive guard
# -----------------------------------------------------------------------------
write('e2e/acquisition-referrals.spec.ts', r'''import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { browserLogin, signedInClient, anonClient } from './helpers';

const suffix = () => randomUUID().slice(0, 8);

async function insertPatient(client: Awaited<ReturnType<typeof signedInClient>>, data: Record<string, unknown>) {
  const { data: row, error } = await client.from('patients').insert(data).select('*').single();
  if (error) throw error;
  return row as Record<string, any>;
}

test.describe.serial('Hub Giulia 4.2 acquisition and referrals', () => {
  test('DB preserves canonical/manual referral, blocks cross-tenant/self referral and conversion overwrite', async () => {
    const a = await signedInClient('a');
    const b = await signedInClient('b');
    const maria = await insertPatient(a, { name: `Maria Ref ${suffix()}`, acquisition_source: 'instagram' });
    const ana = await insertPatient(a, { name: `Ana Ref ${suffix()}`, acquisition_source: 'referral', referred_by_patient_id: maria.id });
    const manual = await insertPatient(a, { name: `Manual Ref ${suffix()}`, acquisition_source: 'referral', referrer_name: 'Fernanda Souza' });
    expect(ana.referred_by_patient_id).toBe(maria.id);
    expect(manual.referrer_name).toBe('Fernanda Souza');

    const selfId = randomUUID();
    const { error: selfError } = await a.from('patients').insert({ id: selfId, name: `Self ${suffix()}`, acquisition_source: 'referral', referred_by_patient_id: selfId });
    expect(selfError).toBeTruthy();

    const { error: crossError } = await b.from('patients').insert({ name: `Cross ${suffix()}`, acquisition_source: 'referral', referred_by_patient_id: maria.id });
    expect(crossError).toBeTruthy();

    const key = randomUUID();
    const { data: lead, error: leadError } = await a.rpc('create_crm_lead_v2', { p_name: `Lead Referral ${suffix()}`, p_source: 'referral', p_referred_by_patient_id: maria.id, p_idempotency_key: key });
    if (leadError) throw leadError;
    const { data: convertedId, error: convertError } = await a.rpc('convert_crm_contact_to_patient_v1', { p_contact_id: lead.contact_id, p_existing_patient_id: null });
    if (convertError) throw convertError;
    const { data: converted } = await a.from('patients').select('acquisition_source,referred_by_patient_id').eq('id', convertedId).single();
    expect(converted?.acquisition_source).toBe('referral');
    expect(converted?.referred_by_patient_id).toBe(maria.id);
    const { data: convertedAgain } = await a.rpc('convert_crm_contact_to_patient_v1', { p_contact_id: lead.contact_id, p_existing_patient_id: null });
    expect(convertedAgain).toBe(convertedId);

    const existing = await insertPatient(a, { name: `Existing ${suffix()}`, acquisition_source: 'referral', referred_by_patient_id: maria.id });
    const { data: instagramLead, error: instagramLeadError } = await a.rpc('create_crm_lead_v2', { p_name: `Instagram Recent ${suffix()}`, p_source: 'instagram', p_idempotency_key: randomUUID() });
    if (instagramLeadError) throw instagramLeadError;
    const { error: linkError } = await a.rpc('convert_crm_contact_to_patient_v1', { p_contact_id: instagramLead.contact_id, p_existing_patient_id: existing.id });
    if (linkError) throw linkError;
    const { data: existingAfter } = await a.from('patients').select('acquisition_source,referred_by_patient_id').eq('id', existing.id).single();
    expect(existingAfter?.acquisition_source).toBe('referral');
    expect(existingAfter?.referred_by_patient_id).toBe(maria.id);
  });

  test('report deduplicates attended patients, counts procedures and sums performed item value', async () => {
    const a = await signedInClient('a');
    const patient = await insertPatient(a, { name: `Report Instagram ${suffix()}`, acquisition_source: 'instagram' });
    const { data: service, error: serviceError } = await a.from('services').insert({ name: `Service ${suffix()}`, type: 'servico', price: 100, cost_per_unit: 10, active: true, is_injectable: false }).select('id').single();
    if (serviceError) throw serviceError;
    for (let index = 0; index < 4; index += 1) {
      const { data: procedure, error: procedureError } = await a.from('procedures').insert({ patient_id: patient.id, performed_at: new Date().toISOString(), services_ids: [service.id], total_value: 100, total_cost: 10, payment_method: 'pix', net_value: 100, gross_value: 100, covered_value: 0 }).select('id').single();
      if (procedureError) throw procedureError;
      const { error: itemError } = await a.from('procedure_items').insert({ procedure_id: procedure.id, service_id: service.id, name: 'E2E Acquisition Service', qty: 1, list_price: 100, final_price: 100, discount: 0, cost_snapshot: 10, coverage_value_snapshot: 0, amount_due_snapshot: 100 });
      if (itemError) throw itemError;
    }
    const today = new Date();
    const start = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-01`;
    const nextMonth = new Date(today.getFullYear(), today.getMonth()+1, 1);
    const end = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth()+1).padStart(2,'0')}-01`;
    const { data: report, error: reportError } = await a.rpc('get_acquisition_summary_v1', { p_start_date: start, p_end_date_exclusive: end });
    if (reportError) throw reportError;
    const instagram = report.sources.find((row: any) => row.source === 'instagram');
    expect(Number(instagram.attended_patients)).toBeGreaterThanOrEqual(1);
    expect(Number(instagram.procedures)).toBeGreaterThanOrEqual(4);
    expect(Number(instagram.production_value)).toBeGreaterThanOrEqual(400);

    await a.from('patients').update({ archived_at: new Date().toISOString() }).eq('id', patient.id);
    const { data: reportArchived, error: archivedError } = await a.rpc('get_acquisition_summary_v1', { p_start_date: start, p_end_date_exclusive: end });
    if (archivedError) throw archivedError;
    const archivedInstagram = reportArchived.sources.find((row: any) => row.source === 'instagram');
    expect(Number(archivedInstagram.procedures)).toBeGreaterThanOrEqual(4);
  });

  test('anonymous report access is denied', async () => {
    const anon = anonClient();
    const { error } = await anon.rpc('get_acquisition_summary_v1', { p_start_date: '2026-08-01', p_end_date_exclusive: '2026-09-01' });
    expect(error).toBeTruthy();
  });

  test('new patient source UX preserves dirty guard and is touch usable', async ({ page }) => {
    await browserLogin(page);
    for (const viewport of [{width:390,height:844},{width:430,height:932},{width:768,height:1024},{width:1024,height:768},{width:1180,height:820},{width:1366,height:1024},{width:1440,height:900}]) {
      await page.setViewportSize(viewport);
      await page.goto('/pacientes');
      await page.getByRole('button', { name: 'Nova paciente' }).click();
      const select = page.getByTestId('new-patient-acquisition-source');
      await expect(select).toBeVisible();
      const box = await select.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
      await page.getByPlaceholder('Nome completo').fill(`Draft ${suffix()}`);
      await select.selectOption('referral');
      await page.locator('[data-testid="new-patient-backdrop"]').click({ position: { x: 3, y: 3 } });
      await expect(page.getByRole('dialog', { name: 'Nova Paciente' })).toBeVisible();
      await page.getByRole('button', { name: 'Fechar cadastro' }).click();
      await page.getByRole('button', { name: 'Descartar' }).click();
    }
  });

  test('acquisition report page is reachable from CRM', async ({ page }) => {
    await browserLogin(page);
    await page.goto('/crm');
    await page.getByRole('button', { name: 'Aquisição & Indicações' }).click();
    await expect(page.getByTestId('acquisition-page')).toBeVisible();
    await expect(page.getByText('Cadastros no período')).toBeVisible();
    await expect(page.getByText('Pacientes que mais indicaram')).toBeVisible();
  });
});
''')

print('Hub Giulia 4.2 patch applied successfully')
