import { describe, expect, it } from 'vitest';
import {
  CONTRACT_PREVIEW_VARS,
  extractContractPlaceholders,
  interpolateContract,
  unresolvedContractPlaceholders,
} from './contractUtils';

describe('contractUtils', () => {
  it('interpolates controlled placeholders with optional whitespace', () => {
    expect(interpolateContract('Olá {{ patient_name }} — {{current_date}}', CONTRACT_PREVIEW_VARS))
      .toBe('Olá Maria da Silva — 14/08/2026');
  });

  it('keeps an unknown placeholder visible instead of silently erasing it', () => {
    expect(interpolateContract('Teste {{unknown_key}}', CONTRACT_PREVIEW_VARS))
      .toContain('{{unknown_key}}');
  });

  it('extracts each placeholder once in normalized form', () => {
    expect(extractContractPlaceholders('{{ Patient_Name }} {{patient_name}} {{total_value}}'))
      .toEqual(['patient_name', 'total_value']);
  });

  it('detects unresolved required values', () => {
    expect(unresolvedContractPlaceholders('{{patient_name}} {{professional_registration}}', {
      patient_name: 'Maria',
      professional_registration: '',
    })).toEqual(['professional_registration']);
  });

  it('supports legacy placeholder aliases during migration', () => {
    expect(interpolateContract('{{nome}} — {{servico}} — {{valor}}', CONTRACT_PREVIEW_VARS))
      .toBe('Maria da Silva — Toxina Botulínica — R$ 1.500,00');
  });
});
