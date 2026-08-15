import { describe, expect, it } from 'vitest';
import { appendReturnTo, attentionCategoryLabel } from './operational';

describe('operational helpers', () => {
  it('preserves patient deep-link query while adding return context', () => {
    expect(appendReturnTo('/pacientes/p-1?tab=photos', '/relacionamento?category=return&q=ana')).toBe('/pacientes/p-1?tab=photos&return_to=%2Frelacionamento%3Fcategory%3Dreturn%26q%3Dana');
  });

  it('does not append patient return state to unrelated modules', () => {
    expect(appendReturnTo('/crm?deal=1', '/relacionamento')).toBe('/crm?deal=1');
  });

  it('keeps domain labels distinct', () => {
    expect(attentionCategoryLabel('return')).toBe('Retorno');
    expect(attentionCategoryLabel('aftercare')).toBe('Pós-atendimento');
    expect(attentionCategoryLabel('relationship')).toBe('Relacionamento');
  });
});
