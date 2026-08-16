export const ANAMNESIS_FORM_SCHEMA_VERSION = 3;
export const ANAMNESIS_AUTOSAVE_MS = 1000;

export type AnswerStatus = 'reported' | 'none' | null;
export type ClinicalAnswerMap = Record<string, boolean | string | undefined>;
export type AnamnesisSaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'offline' | 'error' | 'session-expired' | 'conflict';

export interface AnamnesisDraft {
  conditions: ClinicalAnswerMap;
  medications: string;
  medicationsStatus: AnswerStatus;
  /** Legacy v1/v2 top-level allergy payload. Readable but never reinterpreted as v3 answers. */
  allergies: string;
  allergiesStatus: AnswerStatus;
  surgicalHistory: ClinicalAnswerMap;
  habits: ClinicalAnswerMap;
  aesthetics: ClinicalAnswerMap;
}

export interface AnamnesisCurrentRow {
  id: string;
  patient_id: string;
  user_id: string;
  conditions: ClinicalAnswerMap;
  medications: string | null;
  medications_status: AnswerStatus;
  allergies: string | null;
  allergies_status: AnswerStatus;
  surgical_history: ClinicalAnswerMap;
  habits: ClinicalAnswerMap;
  aesthetics: ClinicalAnswerMap;
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

export interface AnamnesisRecoveryRecord { draft: AnamnesisDraft; baseRevision: number; }
export interface AnamnesisValidationIssue { fieldId: string; message: string; }

type Area = 'conditions' | 'surgicalHistory' | 'habits' | 'aesthetics';
type RequiredBinary = { area: Area; key: string; label: string };
type DetailRule = { area: Exclude<Area, 'conditions'>; flag: string; detail: string; label: string };

export const REQUIRED_BINARY_FIELDS: RequiredBinary[] = [
  ...[
    ['hipertensao','Hipertensão'],['hipotensao','Hipotensão'],['diabetes','Diabetes'],['cancer','Câncer'],
    ['problemas_cardiacos','Problemas cardíacos'],['disfuncao_renal','Disfunção renal'],['problemas_vasculares','Problemas vasculares'],
    ['epilepsia','Epilepsia'],['problemas_respiratorios','Problemas respiratórios'],['problemas_tireoide','Problemas de tireoide'],
    ['problemas_coagulacao','Problemas de coagulação'],['marcapasso','Marcapasso'],['fumante','Fumante'],['hiv_aids','HIV/AIDS'],['hepatite','Hepatite'],
  ].map(([key,label]) => ({ area: 'conditions' as const, key, label })),
  ...[
    ['alergia_medicamento','Alergia a medicamento'],['alergia_frutos_mar','Alergia a frutos do mar'],['alergia_abelha','Alergia a picada de abelha/insetos'],
    ['outras_alergias','Outras alergias'],['recebeu_anestesia','Anestesia anterior'],['cirurgias_recentes','Cirurgias recentes'],
    ['protese_metalica','Prótese metálica'],['desmaios','Desmaios/convulsões'],['herpes','Herpes'],['tratamento_medico','Tratamento médico'],
    ['acne','Acne'],['ansioso','Ansiedade'],['estressado','Estresse elevado'],['enxaqueca','Enxaqueca'],['intestino_regular','Intestino regular'],
    ['menstruacao_regular','Menstruação regular'],['colica_menstrual','Cólica menstrual'],
  ].map(([key,label]) => ({ area: 'surgicalHistory' as const, key, label })),
  ...[
    ['leite_derivados','Leite e derivados'],['doces','Açúcar / doces'],['refrigerante','Refrigerante'],['fast_food','Fast food'],
    ['frituras','Frituras'],['bebidas_alcoolicas','Bebidas alcoólicas'],['cigarros','Cigarros'],['alimentacao_especial','Dieta específica'],
    ['suplemento','Suplementação'],['atividade_fisica','Atividade física'],
  ].map(([key,label]) => ({ area: 'habits' as const, key, label })),
  ...[
    ['produto_com_acido','Produto com ácido'],['alteracoes_recentes','Alterações recentes na pele'],['limpeza_pele','Limpeza de pele'],
    ['microagulhamento','Microagulhamento'],['peeling','Peeling'],['laser','Laser'],['toxina_botulinica','Toxina botulínica'],
    ['fios_sustentacao','Fios de sustentação'],['preenchimento_hialuronico','Preenchimento com ácido hialurônico'],['bioestimulador','Bioestimulador'],
    ['plastica_facial','Plástica facial'],['pmma','PMMA'],['outros_tratamentos','Outros tratamentos estéticos'],
  ].map(([key,label]) => ({ area: 'aesthetics' as const, key, label })),
];

export const DETAIL_RULES: DetailRule[] = [
  { area:'surgicalHistory', flag:'alergia_medicamento', detail:'alergia_medicamento_detalhe', label:'Alergia a medicamento: descreva medicamento e reação.' },
  { area:'surgicalHistory', flag:'alergia_frutos_mar', detail:'alergia_frutos_mar_detalhe', label:'Alergia a frutos do mar: descreva.' },
  { area:'surgicalHistory', flag:'alergia_abelha', detail:'alergia_abelha_detalhe', label:'Alergia a picada de abelha/insetos: descreva a reação.' },
  { area:'surgicalHistory', flag:'outras_alergias', detail:'outras_alergias_detalhe', label:'Outras alergias: descreva.' },
  { area:'surgicalHistory', flag:'recebeu_anestesia', detail:'recebeu_anestesia_detalhe', label:'Anestesia anterior: conte qual anestesia/procedimento e se teve alguma reação.' },
  { area:'surgicalHistory', flag:'cirurgias_recentes', detail:'cirurgias_recentes_detalhe', label:'Cirurgias recentes: descreva qual/quando.' },
  { area:'surgicalHistory', flag:'protese_metalica', detail:'protese_metalica_regiao', label:'Prótese metálica: informe a região/contexto.' },
  { area:'surgicalHistory', flag:'desmaios', detail:'desmaio_porque', label:'Desmaios/convulsões: informe o contexto.' },
  { area:'surgicalHistory', flag:'herpes', detail:'herpes_detalhe', label:'Herpes: descreva frequência/contexto.' },
  { area:'surgicalHistory', flag:'tratamento_medico', detail:'tratamento_medico_detalhe', label:'Tratamento médico: informe qual.' },
  { area:'surgicalHistory', flag:'acne', detail:'acne_detalhe', label:'Acne: descreva.' },
  { area:'surgicalHistory', flag:'colica_menstrual', detail:'colica_menstrual_detalhe', label:'Cólica menstrual: descreva.' },
  { area:'habits', flag:'leite_derivados', detail:'leite_derivados_frequencia', label:'Leite e derivados: informe a frequência.' },
  { area:'habits', flag:'doces', detail:'doces_frequencia', label:'Açúcar / doces: informe a frequência.' },
  { area:'habits', flag:'refrigerante', detail:'refrigerante_frequencia', label:'Refrigerante: informe a frequência.' },
  { area:'habits', flag:'fast_food', detail:'fast_food_frequencia', label:'Fast food: informe a frequência.' },
  { area:'habits', flag:'frituras', detail:'frituras_frequencia', label:'Frituras: informe a frequência.' },
  { area:'habits', flag:'bebidas_alcoolicas', detail:'bebidas_alcoolicas_frequencia', label:'Bebidas alcoólicas: informe a frequência.' },
  { area:'habits', flag:'alimentacao_especial', detail:'alimentacao_especial_qual', label:'Dieta específica: descreva.' },
  { area:'habits', flag:'suplemento', detail:'suplemento_quais', label:'Suplementação: informe quais suplementos.' },
  { area:'habits', flag:'atividade_fisica', detail:'atividade_fisica_detalhe', label:'Atividade física: informe tipo/frequência.' },
  { area:'aesthetics', flag:'produto_com_acido', detail:'produto_com_acido_detalhe', label:'Produto com ácido: informe qual/concentração.' },
  { area:'aesthetics', flag:'alteracoes_recentes', detail:'alteracoes_recentes_detalhe', label:'Alterações recentes na pele: descreva.' },
  { area:'aesthetics', flag:'limpeza_pele', detail:'limpeza_pele_data', label:'Limpeza de pele: escreva uma observação/contexto.' },
  { area:'aesthetics', flag:'microagulhamento', detail:'microagulhamento_data', label:'Microagulhamento: escreva uma observação/contexto.' },
  { area:'aesthetics', flag:'peeling', detail:'peeling_detalhe', label:'Peeling: escreva uma observação/contexto.' },
  { area:'aesthetics', flag:'laser', detail:'laser_detalhe', label:'Laser: escreva uma observação/contexto.' },
  { area:'aesthetics', flag:'toxina_botulinica', detail:'toxina_botulinica_data', label:'Toxina botulínica: escreva uma observação/contexto.' },
  { area:'aesthetics', flag:'fios_sustentacao', detail:'fios_sustentacao_data', label:'Fios de sustentação: escreva uma observação/contexto.' },
  { area:'aesthetics', flag:'preenchimento_hialuronico', detail:'preenchimento_hialuronico_data', label:'Preenchimento com ácido hialurônico: escreva uma observação/contexto.' },
  { area:'aesthetics', flag:'bioestimulador', detail:'bioestimulador_data', label:'Bioestimulador: escreva uma observação/contexto.' },
  { area:'aesthetics', flag:'plastica_facial', detail:'plastica_facial_detalhe', label:'Plástica facial: escreva uma observação/contexto.' },
  { area:'aesthetics', flag:'pmma', detail:'pmma_regiao', label:'PMMA: escreva uma observação/contexto.' },
  { area:'aesthetics', flag:'outros_tratamentos', detail:'outros_tratamentos_detalhe', label:'Outros tratamentos estéticos: descreva.' },
];

export const emptyAnamnesisDraft = (): AnamnesisDraft => ({
  conditions: {}, medications: '', medicationsStatus: null, allergies: '', allergiesStatus: null,
  surgicalHistory: {}, habits: {}, aesthetics: {},
});

export function currentRowToDraft(row: AnamnesisCurrentRow | null): AnamnesisDraft {
  if (!row) return emptyAnamnesisDraft();
  return {
    conditions: row.conditions ?? {},
    medications: row.medications ?? '',
    medicationsStatus: row.medications_status ?? (row.medications?.trim() ? 'reported' : null),
    allergies: row.allergies ?? '',
    allergiesStatus: row.allergies_status ?? (row.allergies?.trim() ? 'reported' : null),
    surgicalHistory: row.surgical_history ?? {}, habits: row.habits ?? {}, aesthetics: row.aesthetics ?? {},
  };
}

export function draftToRpcAnswers(draft: AnamnesisDraft) {
  return {
    conditions: draft.conditions,
    medications: draft.medications || null,
    medications_status: draft.medicationsStatus,
    // Preserve legacy allergy columns exactly; v3 allergy answers live in surgical_history.
    allergies: draft.allergies || null,
    allergies_status: draft.allergiesStatus,
    surgical_history: draft.surgicalHistory,
    habits: draft.habits,
    aesthetics: draft.aesthetics,
  };
}

export function validateAnamnesisForCompletion(draft: AnamnesisDraft): AnamnesisValidationIssue[] {
  const issues: AnamnesisValidationIssue[] = [];
  for (const field of REQUIRED_BINARY_FIELDS) {
    const area = draft[field.area];
    if (typeof area[field.key] !== 'boolean') issues.push({ fieldId: `q-${field.area}-${field.key}`, message: `${field.label}: selecione Sim ou Não.` });
  }
  if (draft.medicationsStatus !== 'reported' && draft.medicationsStatus !== 'none') {
    issues.push({ fieldId: 'q-medications', message: 'Medicamento de uso contínuo: selecione Sim ou Não.' });
  } else if (draft.medicationsStatus === 'reported' && !draft.medications.trim()) {
    issues.push({ fieldId: 'detail-medications', message: 'Medicamento de uso contínuo: informe qual(is).' });
  }
  const gestante = String(draft.surgicalHistory.gestante ?? '');
  if (!['sim','não','tentando'].includes(gestante)) issues.push({ fieldId: 'q-surgicalHistory-gestante', message: 'Gestante: selecione uma opção.' });
  for (const rule of DETAIL_RULES) {
    const area = draft[rule.area];
    if (area[rule.flag] === true && !String(area[rule.detail] ?? '').trim()) {
      issues.push({ fieldId: `detail-${rule.area}-${rule.flag}`, message: rule.label });
    }
  }
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
  return ['pending','saving','offline','error','session-expired','conflict'].includes(status);
}

// Clinical drafts never persist in localStorage/IndexedDB. The server-side draft is the source of truth.
export async function saveAnamnesisRecovery(userId: string, patientId: string, draft: AnamnesisDraft, baseRevision: number) {
  void userId; void patientId; void draft; void baseRevision;
}
export async function loadAnamnesisRecovery(userId: string, patientId: string): Promise<AnamnesisRecoveryRecord | null> {
  void userId; void patientId; return null;
}
export async function clearAnamnesisRecovery(userId: string, patientId: string) { void userId; void patientId; }
export async function clearAllAnamnesisRecoveries() {
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>(resolve => {
    const request = indexedDB.deleteDatabase('hub-giulia-anamnesis-recovery-v1');
    request.onsuccess = () => resolve(); request.onerror = () => resolve(); request.onblocked = () => resolve();
  });
}
