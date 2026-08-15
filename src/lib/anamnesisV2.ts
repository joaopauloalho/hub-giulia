import type {
  AnamnesisAesthetics,
  AnamnesisConditions,
  AnamnesisHabits,
  AnamnosisSurgicalHistory,
} from '../types';

export const ANAMNESIS_FORM_SCHEMA_VERSION = 2;
export const ANAMNESIS_AUTOSAVE_MS = 1000;

export type AnswerStatus = 'reported' | 'none' | null;
export type AnamnesisSaveStatus =
  | 'idle'
  | 'pending'
  | 'saving'
  | 'saved'
  | 'offline'
  | 'error'
  | 'session-expired'
  | 'conflict';

export interface AnamnesisDraft {
  conditions: AnamnesisConditions;
  medications: string;
  medicationsStatus: AnswerStatus;
  allergies: string;
  allergiesStatus: AnswerStatus;
  surgicalHistory: AnamnosisSurgicalHistory;
  habits: AnamnesisHabits;
  aesthetics: AnamnesisAesthetics;
}

export interface AnamnesisCurrentRow {
  id: string;
  patient_id: string;
  user_id: string;
  conditions: AnamnesisConditions;
  medications: string | null;
  medications_status: AnswerStatus;
  allergies: string | null;
  allergies_status: AnswerStatus;
  surgical_history: AnamnosisSurgicalHistory;
  habits: AnamnesisHabits;
  aesthetics: AnamnesisAesthetics;
  updated_at: string;
  created_at: string;
  status: 'draft' | 'completed';
  form_schema_version: number;
  draft_revision: number;
  last_saved_at: string | null;
  finalized_at: string | null;
  latest_version_number: number;
}

export interface AnamnesisVersion {
  id: string;
  anamnesis_id: string;
  user_id: string;
  patient_id: string;
  version_number: number;
  form_schema_version: number;
  answers_snapshot: Record<string, unknown>;
  form_schema_snapshot: Record<string, unknown>;
  completed_at: string;
  author_user_id: string | null;
  source_type: string | null;
  migration_source: string | null;
  supersedes_version_id: string | null;
  created_at: string;
}

export interface AnamnesisRecoveryRecord {
  draft: AnamnesisDraft;
  baseRevision: number;
}

export const emptyAnamnesisDraft = (): AnamnesisDraft => ({
  conditions: {},
  medications: '',
  medicationsStatus: null,
  allergies: '',
  allergiesStatus: null,
  surgicalHistory: {},
  habits: {},
  aesthetics: {},
});

export function currentRowToDraft(row: AnamnesisCurrentRow | null): AnamnesisDraft {
  if (!row) return emptyAnamnesisDraft();
  return {
    conditions: row.conditions ?? {},
    medications: row.medications ?? '',
    medicationsStatus: row.medications_status ?? (row.medications?.trim() ? 'reported' : null),
    allergies: row.allergies ?? '',
    allergiesStatus: row.allergies_status ?? (row.allergies?.trim() ? 'reported' : null),
    surgicalHistory: row.surgical_history ?? {},
    habits: row.habits ?? {},
    aesthetics: row.aesthetics ?? {},
  };
}

export function draftToRpcAnswers(draft: AnamnesisDraft) {
  return {
    conditions: draft.conditions,
    medications: draft.medications || null,
    medications_status: draft.medicationsStatus,
    allergies: draft.allergies || null,
    allergies_status: draft.allergiesStatus,
    surgical_history: draft.surgicalHistory,
    habits: draft.habits,
    aesthetics: draft.aesthetics,
  };
}

type ConditionalRule = {
  area: 'surgicalHistory' | 'habits' | 'aesthetics';
  flag: string;
  detail: string;
  label: string;
};

const CONDITIONAL_RULES: ConditionalRule[] = [
  { area: 'surgicalHistory', flag: 'cirurgias_recentes', detail: 'cirurgias_recentes_detalhe', label: 'Cirurgias recentes: informe qual/quando.' },
  { area: 'surgicalHistory', flag: 'protese_metalica', detail: 'protese_metalica_regiao', label: 'Prótese metálica: informe a região.' },
  { area: 'surgicalHistory', flag: 'desmaios', detail: 'desmaio_porque', label: 'Desmaios/convulsões: informe o motivo/contexto.' },
  { area: 'surgicalHistory', flag: 'herpes', detail: 'herpes_detalhe', label: 'Herpes: informe a frequência.' },
  { area: 'surgicalHistory', flag: 'alergia_anestesia', detail: 'alergia_anestesia_detalhe', label: 'Alergia a anestesia: informe qual.' },
  { area: 'surgicalHistory', flag: 'alergia_abelha', detail: 'alergia_abelha_detalhe', label: 'Alergia a abelha/insetos: informe a reação.' },
  { area: 'surgicalHistory', flag: 'tratamento_medico', detail: 'tratamento_medico_detalhe', label: 'Tratamento médico: informe qual.' },
  { area: 'surgicalHistory', flag: 'tpm', detail: 'tpm_o_que_faz', label: 'TPM intensa: informe o que costuma fazer.' },
  { area: 'habits', flag: 'alimentacao_especial', detail: 'alimentacao_especial_qual', label: 'Alimentação especial/dieta: informe qual.' },
  { area: 'habits', flag: 'suplemento', detail: 'suplemento_quais', label: 'Suplementação: informe quais suplementos.' },
  { area: 'habits', flag: 'atividade_fisica', detail: 'atividade_fisica_detalhe', label: 'Atividade física: informe tipo/frequência.' },
  { area: 'aesthetics', flag: 'produto_com_acido', detail: 'produto_com_acido_detalhe', label: 'Produto com ácido: informe qual/concentração.' },
  { area: 'aesthetics', flag: 'limpeza_pele', detail: 'limpeza_pele_data', label: 'Limpeza de pele: informe a data.' },
  { area: 'aesthetics', flag: 'microagulhamento', detail: 'microagulhamento_data', label: 'Microagulhamento: informe a data.' },
  { area: 'aesthetics', flag: 'peeling', detail: 'peeling_detalhe', label: 'Peeling: informe tipo/data.' },
  { area: 'aesthetics', flag: 'toxina_botulinica', detail: 'toxina_botulinica_data', label: 'Toxina botulínica: informe a última aplicação.' },
  { area: 'aesthetics', flag: 'fios_sustentacao', detail: 'fios_sustentacao_data', label: 'Fios de sustentação: informe quando.' },
  { area: 'aesthetics', flag: 'preenchimento_hialuronico', detail: 'preenchimento_hialuronico_data', label: 'Preenchimento com ácido hialurônico: informe quando.' },
  { area: 'aesthetics', flag: 'bioestimulador', detail: 'bioestimulador_data', label: 'Bioestimulador: informe quando.' },
  { area: 'aesthetics', flag: 'plastica_facial', detail: 'plastica_facial_detalhe', label: 'Plástica facial: informe qual/quando.' },
  { area: 'aesthetics', flag: 'pmma', detail: 'pmma_regiao', label: 'PMMA: informe a região.' },
  { area: 'aesthetics', flag: 'outros_tratamentos', detail: 'outros_tratamentos_detalhe', label: 'Outros tratamentos estéticos: informe quais.' },
  { area: 'aesthetics', flag: 'alteracoes_recentes', detail: 'alteracoes_recentes_detalhe', label: 'Alterações recentes na pele: descreva.' },
];

export function validateAnamnesisForCompletion(draft: AnamnesisDraft): string[] {
  const issues: string[] = [];
  for (const rule of CONDITIONAL_RULES) {
    const area = draft[rule.area] as Record<string, unknown>;
    if (area[rule.flag] === true && !String(area[rule.detail] ?? '').trim()) issues.push(rule.label);
  }
  if (draft.medicationsStatus === 'reported' && !draft.medications.trim()) issues.push('Medicamentos em uso: descreva os medicamentos informados.');
  if (draft.allergiesStatus === 'reported' && !draft.allergies.trim()) issues.push('Alergias conhecidas: descreva as alergias informadas.');
  return issues;
}

export function isAnamnesisConflict(error: unknown) {
  const message = error instanceof Error ? error.message : String((error as { message?: string } | null)?.message ?? '');
  return /ANAMNESIS_REVISION_CONFLICT/i.test(message);
}

export function isAnamnesisSessionError(error: unknown) {
  const message = error instanceof Error ? error.message : String((error as { message?: string } | null)?.message ?? '');
  return /ANAMNESIS_SESSION_REQUIRED|JWT|session|refresh token/i.test(message);
}

export function hasUnsyncedAnamnesis(status: AnamnesisSaveStatus) {
  return ['pending', 'saving', 'offline', 'error', 'session-expired', 'conflict'].includes(status);
}

// Hub Giulia 3.5 privacy policy: clinical drafts are never persisted in
// localStorage/IndexedDB. The autosave source of truth is the server-side draft.
// These compatibility functions remain intentionally memoryless so existing
// Anamnese 2.0 call sites do not gain an offline clinical database.
export async function saveAnamnesisRecovery(userId: string, patientId: string, draft: AnamnesisDraft, baseRevision: number) {
  void userId; void patientId; void draft; void baseRevision;
}

export async function loadAnamnesisRecovery(userId: string, patientId: string): Promise<AnamnesisRecoveryRecord | null> {
  void userId; void patientId;
  return null;
}

export async function clearAnamnesisRecovery(userId: string, patientId: string) {
  void userId; void patientId;
}

export async function clearAllAnamnesisRecoveries() {
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>(resolve => {
    const request = indexedDB.deleteDatabase('hub-giulia-anamnesis-recovery-v1');
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}
