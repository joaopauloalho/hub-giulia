import { describe, expect, it } from 'vitest';
import {
  ANAMNESIS_AUTOSAVE_MS,
  ANAMNESIS_FORM_SCHEMA_VERSION,
  currentRowToDraft,
  draftToRpcAnswers,
  emptyAnamnesisDraft,
  hasUnsyncedAnamnesis,
  validateAnamnesisForCompletion,
  type AnamnesisCurrentRow,
} from './anamnesisV2';

describe('Anamnese clinical UX v4', () => {
  it('permite concluir uma anamnese completamente vazia', () => {
    expect(validateAnamnesisForCompletion(emptyAnamnesisDraft())).toEqual([]);
  });

  it('permite respostas parciais, Sim sem detalhe e medicamento sem complemento', () => {
    const draft = emptyAnamnesisDraft();
    draft.conditions.hipertensao = true;
    draft.surgicalHistory.alergia_medicamento = true;
    draft.habits.leite_derivados = true;
    draft.aesthetics.limpeza_pele = true;
    draft.medicationsStatus = 'reported';
    expect(validateAnamnesisForCompletion(draft)).toEqual([]);
  });

  it('mantém schema v4 e autosave curto após cada alteração', () => {
    expect(ANAMNESIS_FORM_SCHEMA_VERSION).toBe(4);
    expect(ANAMNESIS_AUTOSAVE_MS).toBeLessThanOrEqual(300);
  });

  it('preserva texto/status legado sem fabricar resposta clínica e remove Última LP da edição atual', () => {
    const base = {
      id:'a',patient_id:'p',user_id:'u',conditions:{},medications:'Medicamento legado',medications_status:null,
      allergies:null,allergies_status:null,surgical_history:{ tpm: true, tpm_o_que_faz: 'Legado' },habits:{},aesthetics:{ limpeza_pele_data:'2025-08-12', ultima_limpeza_pele:'há 2 meses' },
      updated_at:'2026-08-14T00:00:00Z',created_at:'2026-08-14T00:00:00Z',status:'completed',form_schema_version:3,draft_revision:1,last_saved_at:'2026-08-14T00:00:00Z',finalized_at:'2026-08-14T00:00:00Z',latest_version_number:1,
    } satisfies AnamnesisCurrentRow;
    const draft=currentRowToDraft(base);
    expect(draft.medicationsStatus).toBe('reported');
    expect(draft.surgicalHistory.tpm).toBe(true);
    expect(draft.aesthetics.limpeza_pele_data).toBe('2025-08-12');
    expect(draft.aesthetics.ultima_limpeza_pele).toBeUndefined();
    expect((draftToRpcAnswers(draft).aesthetics as Record<string, unknown>).ultima_limpeza_pele).toBeUndefined();
    expect(currentRowToDraft({...base,medications:null}).medicationsStatus).toBeNull();
  });

  it('preserva pergunta sem seleção no draft e não converte para Não', () => {
    const draft = emptyAnamnesisDraft();
    expect(draft.conditions.hipertensao).toBeUndefined();
    expect(draftToRpcAnswers(draft).conditions).toEqual({});
  });

  it('considera estados de erro e rede como alterações não sincronizadas', () => {
    expect(hasUnsyncedAnamnesis('offline')).toBe(true);
    expect(hasUnsyncedAnamnesis('conflict')).toBe(true);
    expect(hasUnsyncedAnamnesis('saved')).toBe(false);
  });
});
