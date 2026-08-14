import { describe, expect, it } from 'vitest';
import {
  CRM_LOSS_REASON_LABEL,
  CRM_SOURCE_LABEL,
  CRM_STAGE_LABEL,
  followupBucket,
  followupShortcut,
  formatCrmValue,
  isClosedCrmStage,
  normalizeCrmEmail,
  normalizeCrmPhone,
  safeCrmSearchTerm,
} from './crm';

describe('crm domain helpers', () => {
  it('keeps stable stage, source and loss reason labels', () => {
    expect(CRM_STAGE_LABEL.new).toBe('Novo lead');
    expect(CRM_STAGE_LABEL.negotiation).toBe('Negociação');
    expect(CRM_SOURCE_LABEL.referral).toBe('Indicação');
    expect(CRM_LOSS_REASON_LABEL.clinical_decision).toBe('Decisão clínica');
  });

  it('recognizes terminal deal states', () => {
    expect(isClosedCrmStage('won')).toBe(true);
    expect(isClosedCrmStage('lost')).toBe(true);
    expect(isClosedCrmStage('negotiation')).toBe(false);
  });

  it('classifies follow-ups relative to the clinic calendar day', () => {
    const today = '2026-08-14';
    expect(followupBucket('2026-08-13', today)).toBe('overdue');
    expect(followupBucket('2026-08-14', today)).toBe('today');
    expect(followupBucket('2026-08-15', today)).toBe('upcoming');
    expect(followupBucket(null, today)).toBeNull();
  });

  it('builds date-only follow-up shortcuts without inventing a time', () => {
    expect(followupShortcut(0, '2026-08-14')).toBe('2026-08-14');
    expect(followupShortcut(1, '2026-08-14')).toBe('2026-08-15');
    expect(followupShortcut(7, '2026-08-14')).toBe('2026-08-21');
  });

  it('reuses patient phone normalization for CRM', () => {
    expect(normalizeCrmPhone('+55 (43) 99999-8888')).toBe('(43) 99999-8888');
    expect(normalizeCrmPhone('')).toBeNull();
  });

  it('normalizes email consistently', () => {
    expect(normalizeCrmEmail('  MARIA@EXEMPLO.COM ')).toBe('maria@exemplo.com');
    expect(normalizeCrmEmail('')).toBeNull();
  });

  it('does not render a missing value as zero', () => {
    expect(formatCrmValue(null)).toBeNull();
    expect(formatCrmValue('')).toBeNull();
    expect(formatCrmValue(1250)).toContain('1.250');
  });

  it('sanitizes characters that interfere with PostgREST OR search syntax', () => {
    expect(safeCrmSearchTerm('  Maria,(43)  ')).toBe('Maria 43');
  });
});
