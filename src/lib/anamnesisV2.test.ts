import { describe, expect, it } from 'vitest';
import {
  DETAIL_RULES,
  REQUIRED_BINARY_FIELDS,
  currentRowToDraft,
  draftToRpcAnswers,
  emptyAnamnesisDraft,
  hasUnsyncedAnamnesis,
  validateAnamnesisForCompletion,
  type AnamnesisCurrentRow,
  type AnamnesisDraft,
} from './anamnesisV2';

function completeDraft(): AnamnesisDraft {
  const draft = emptyAnamnesisDraft();
  for (const field of REQUIRED_BINARY_FIELDS) draft[field.area][field.key] = false;
  draft.medicationsStatus = 'none';
  draft.surgicalHistory.gestante = 'não';
  return draft;
}

describe('Anamnese clinical UX v3', () => {
  it('preserva pergunta nova sem seleção no draft e não converte para Não', () => {
    const draft = emptyAnamnesisDraft();
    expect(draft.conditions.hipertensao).toBeUndefined();
    expect(draftToRpcAnswers(draft).conditions).toEqual({});
  });

  it('preserva texto/status legado sem fabricar resposta clínica', () => {
    const base = {
      id:'a',patient_id:'p',user_id:'u',conditions:{},medications:'Medicamento legado',medications_status:null,
      allergies:null,allergies_status:null,surgical_history:{ tpm: true, tpm_o_que_faz: 'Legado' },habits:{},aesthetics:{ limpeza_pele_data:'2025-08-12' },
      updated_at:'2026-08-14T00:00:00Z',created_at:'2026-08-14T00:00:00Z',status:'completed',form_schema_version:2,draft_revision:1,last_saved_at:'2026-08-14T00:00:00Z',finalized_at:'2026-08-14T00:00:00Z',latest_version_number:1,
    } satisfies AnamnesisCurrentRow;
    const draft=currentRowToDraft(base);
    expect(draft.medicationsStatus).toBe('reported');
    expect(draft.surgicalHistory.tpm).toBe(true);
    expect(draft.surgicalHistory.colica_menstrual).toBeUndefined();
    expect(draft.aesthetics.limpeza_pele_data).toBe('2025-08-12');
    expect(currentRowToDraft({...base,medications:null}).medicationsStatus).toBeNull();
  });

  it('bloqueia conclusão quando binárias obrigatórias ainda estão sem escolha', () => {
    const issues=validateAnamnesisForCompletion(emptyAnamnesisDraft());
    expect(issues.some(issue=>issue.fieldId==='q-conditions-hipertensao')).toBe(true);
    expect(issues.some(issue=>issue.message.includes('selecione Sim ou Não'))).toBe(true);
  });

  it('permite Não sem descrição', () => {
    const draft=completeDraft();
    expect(validateAnamnesisForCompletion(draft)).toEqual([]);
  });

  it('todo Sim configurado exige descrição e passa quando preenchido', () => {
    for (const rule of DETAIL_RULES) {
      const draft=completeDraft();
      draft[rule.area][rule.flag]=true;
      const missing=validateAnamnesisForCompletion(draft);
      expect(missing.some(issue=>issue.fieldId===`detail-${rule.area}-${rule.flag}`),rule.flag).toBe(true);
      draft[rule.area][rule.detail]='Contexto informado pela profissional';
      expect(validateAnamnesisForCompletion(draft).some(issue=>issue.fieldId===`detail-${rule.area}-${rule.flag}`),rule.flag).toBe(false);
    }
  });

  it('medicamento contínuo Sim exige Qual(is), Não não exige', () => {
    const draft=completeDraft();draft.medicationsStatus='reported';
    expect(validateAnamnesisForCompletion(draft).some(i=>i.fieldId==='detail-medications')).toBe(true);
    draft.medications='Losartana';expect(validateAnamnesisForCompletion(draft).some(i=>i.fieldId==='detail-medications')).toBe(false);
    draft.medicationsStatus='none';draft.medications='';expect(validateAnamnesisForCompletion(draft).some(i=>i.fieldId==='detail-medications')).toBe(false);
  });

  it('procedimento Sim exige observação; Não aceita vazio ou observação preservada', () => {
    const draft=completeDraft();draft.aesthetics.limpeza_pele=true;
    expect(validateAnamnesisForCompletion(draft).some(i=>i.fieldId==='detail-aesthetics-limpeza_pele')).toBe(true);
    draft.aesthetics.limpeza_pele_data='Há uns 6 meses';
    expect(validateAnamnesisForCompletion(draft).some(i=>i.fieldId==='detail-aesthetics-limpeza_pele')).toBe(false);
    draft.aesthetics.limpeza_pele=false;
    expect(draft.aesthetics.limpeza_pele_data).toBe('Há uns 6 meses');
    expect(validateAnamnesisForCompletion(draft)).toEqual([]);
  });

  it('frequência alimentar é livre e obrigatória somente no Sim', () => {
    const draft=completeDraft();draft.habits.leite_derivados=true;
    expect(validateAnamnesisForCompletion(draft).some(i=>i.fieldId==='detail-habits-leite_derivados')).toBe(true);
    draft.habits.leite_derivados_frequencia='2 a 3 vezes por semana';
    expect(validateAnamnesisForCompletion(draft).some(i=>i.fieldId==='detail-habits-leite_derivados')).toBe(false);
  });

  it('considera estados de erro e rede como alterações não sincronizadas', () => {
    expect(hasUnsyncedAnamnesis('offline')).toBe(true);expect(hasUnsyncedAnamnesis('conflict')).toBe(true);expect(hasUnsyncedAnamnesis('saved')).toBe(false);
  });
});
