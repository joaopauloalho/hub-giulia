import { describe, expect, it } from 'vitest';
import {
  currentRowToDraft,
  draftToRpcAnswers,
  emptyAnamnesisDraft,
  hasUnsyncedAnamnesis,
  validateAnamnesisForCompletion,
  type AnamnesisCurrentRow,
} from './anamnesisV2';

describe('Anamnese 2.0', () => {
  it('preserva não respondido sem converter para Não', () => {
    const draft = emptyAnamnesisDraft();
    expect(draft.conditions.hipertensao).toBeUndefined();
    expect(draftToRpcAnswers(draft).conditions).toEqual({});
  });

  it('interpreta texto legado existente como informado sem inventar resposta quando vazio', () => {
    const base = {
      id: 'a',
      patient_id: 'p',
      user_id: 'u',
      conditions: {},
      medications: 'Medicamento legado',
      medications_status: null,
      allergies: null,
      allergies_status: null,
      surgical_history: {},
      habits: {},
      aesthetics: {},
      updated_at: '2026-08-14T00:00:00Z',
      created_at: '2026-08-14T00:00:00Z',
      status: 'completed',
      form_schema_version: 1,
      draft_revision: 1,
      last_saved_at: '2026-08-14T00:00:00Z',
      finalized_at: '2026-08-14T00:00:00Z',
      latest_version_number: 1,
    } satisfies AnamnesisCurrentRow;

    expect(currentRowToDraft(base).medicationsStatus).toBe('reported');
    expect(currentRowToDraft({ ...base, medications: null }).medicationsStatus).toBeNull();
  });

  it('bloqueia conclusão quando um Sim condicional não tem detalhe', () => {
    const draft = emptyAnamnesisDraft();
    draft.surgicalHistory.tratamento_medico = true;
    expect(validateAnamnesisForCompletion(draft)).toContain('Tratamento médico: informe qual.');
  });

  it('exige descrição quando medicamentos ou alergias foram marcados como informados', () => {
    const draft = emptyAnamnesisDraft();
    draft.medicationsStatus = 'reported';
    draft.allergiesStatus = 'reported';
    expect(validateAnamnesisForCompletion(draft)).toHaveLength(2);
  });

  it('considera estados de erro e rede como alterações não sincronizadas', () => {
    expect(hasUnsyncedAnamnesis('offline')).toBe(true);
    expect(hasUnsyncedAnamnesis('conflict')).toBe(true);
    expect(hasUnsyncedAnamnesis('saved')).toBe(false);
  });
});
