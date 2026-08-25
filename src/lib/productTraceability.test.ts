import { describe, expect, it } from 'vitest';
import { formatTraceabilityExpiry, isExpiredTraceabilityDate, productEvidenceStoragePaths, traceabilityModeLabel } from './productTraceability';

describe('product traceability helpers', () => {
  it('builds tenant and patient segregated immutable evidence paths', () => {
    expect(productEvidenceStoragePaths('u1', 'p1', 'e1', 'image/jpeg')).toEqual({
      original: 'u1/patients/p1/product-evidence/e1/original.jpg',
      preview: 'u1/patients/p1/product-evidence/e1/preview.jpg',
      thumbnail: 'u1/patients/p1/product-evidence/e1/thumb.jpg',
    });
  });

  it('flags only dates before the local current day as expired', () => {
    const now = new Date(2026, 7, 25, 14, 32, 0);
    expect(isExpiredTraceabilityDate('2026-08-24', now)).toBe(true);
    expect(isExpiredTraceabilityDate('2026-08-25', now)).toBe(false);
    expect(isExpiredTraceabilityDate('2027-10-31', now)).toBe(false);
    expect(isExpiredTraceabilityDate(null, now)).toBe(false);
  });

  it('formats expiry and traceability modes for the UI', () => {
    expect(formatTraceabilityExpiry('2027-10-31')).toBe('31/10/2027');
    expect(traceabilityModeLabel('none')).toBe('Não utilizar');
    expect(traceabilityModeLabel('optional')).toBe('Opcional');
    expect(traceabilityModeLabel('recommended')).toBe('Recomendada');
  });
});
