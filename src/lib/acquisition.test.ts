import { describe, expect, it } from 'vitest';
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
