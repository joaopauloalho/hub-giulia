import { describe, expect, it } from 'vitest';
import { aftercareDate, emptyServiceAftercareProtocol, normalizeServiceAftercareProtocol, orientationStatusLabel, validateAftercareSteps } from './useAftercare';

describe('aftercare helpers', () => {
  it('starts with no clinical timing defaults', () => {
    const protocol = emptyServiceAftercareProtocol('service-1');
    expect(protocol.enabled).toBe(false);
    expect(protocol.instructions).toBe('');
    expect(protocol.steps).toEqual([]);
    expect(protocol.photo_followup).toBe(false);
  });

  it('validates integer unique check-in offsets without inventing defaults', () => {
    expect(validateAftercareSteps([{ offset_days: 2, label: null }, { offset_days: 7, label: 'Check-in' }])).toBeNull();
    expect(validateAftercareSteps([{ offset_days: 2, label: null }, { offset_days: 2, label: null }])).toMatch(/repita/i);
    expect(validateAftercareSteps([{ offset_days: Number.NaN, label: null }])).toMatch(/dias inteiros/i);
    expect(validateAftercareSteps([{ offset_days: 2.5, label: null }])).toMatch(/dias inteiros/i);
  });

  it('normalizes server protocol snapshots without mutating text', () => {
    const protocol = normalizeServiceAftercareProtocol('s1', { id: 'p1', enabled: true, version: 3, instructions: 'Texto da profissional', photo_followup: true, steps: [{ offset_days: 4, label: 'Contato' }] });
    expect(protocol.instructions).toBe('Texto da profissional');
    expect(protocol.version).toBe(3);
    expect(protocol.steps[0].offset_days).toBe(4);
  });

  it('formats due_on as a clinical date in Sao Paulo semantics', () => {
    expect(aftercareDate('2026-08-16')).toBe('16/08/2026');
  });

  it('keeps orientation labels factual', () => {
    expect(orientationStatusLabel('pending')).toMatch(/Pendente/);
    expect(orientationStatusLabel('sent_whatsapp')).not.toMatch(/lida|entregue/i);
  });
});
