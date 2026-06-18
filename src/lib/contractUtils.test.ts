import { describe, expect, it } from 'vitest';
import { interpolateContract } from './contractUtils';

describe('interpolateContract', () => {
  it('replaces known placeholders', () => {
    expect(interpolateContract('Paciente: {{ nome }}', { nome: 'Giulia' })).toBe('Paciente: Giulia');
  });

  it('keeps unknown placeholders unchanged', () => {
    expect(interpolateContract('{{nome}} - {{procedimento}}', { nome: 'Ana' })).toBe('Ana - {{procedimento}}');
  });

  it('supports numeric and underscore placeholder keys', () => {
    expect(interpolateContract('{{ contrato_1 }} / {{valor2}}', {
      contrato_1: 'A',
      valor2: 'R$ 100',
    })).toBe('A / R$ 100');
  });
});
