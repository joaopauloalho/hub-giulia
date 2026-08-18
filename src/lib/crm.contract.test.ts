import { describe, expect, it } from 'vitest';
import {
  CRM_CHANNEL_KEYS,
  CRM_LOSS_REASON_KEYS,
  CRM_OPEN_STAGES,
  CRM_SOURCE_KEYS,
  CRM_STAGE_KEYS,
  followupShortcut,
  formatCrmValue,
} from './crm';

describe('CRM 2.0 stable contracts', () => {
  it('keeps the pipeline keys stable for persisted data and future analytics', () => {
    expect(CRM_STAGE_KEYS).toEqual([
      'new',
      'contacted',
      'assessment_scheduled',
      'proposal_sent',
      'negotiation',
      'won',
      'lost',
    ]);
    expect(CRM_OPEN_STAGES).toEqual([
      'new',
      'contacted',
      'assessment_scheduled',
      'proposal_sent',
      'negotiation',
    ]);
  });

  it('uses the shared acquisition-source keys for new CRM data', () => {
    expect(CRM_SOURCE_KEYS).toEqual([
      'instagram',
      'referral',
      'google',
      'partnership',
      'existing_patient',
      'campaign',
      'other',
    ]);
    expect(CRM_SOURCE_KEYS).not.toContain('whatsapp');
  });

  it('keeps loss reasons structured for conversion analytics', () => {
    expect(CRM_LOSS_REASON_KEYS).toEqual([
      'price',
      'postponed',
      'no_response',
      'competitor',
      'not_interested',
      'clinical_decision',
      'other',
    ]);
  });

  it('keeps manual commercial channels explicit', () => {
    expect(CRM_CHANNEL_KEYS).toEqual(['whatsapp', 'phone', 'instagram', 'other']);
  });

  it('handles calendar shortcuts across month boundaries and displays explicit zero values', () => {
    expect(followupShortcut(1, '2026-08-31')).toBe('2026-09-01');
    expect(formatCrmValue(0)).toContain('0,00');
  });
});
