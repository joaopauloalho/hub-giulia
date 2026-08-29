import { describe, expect, it } from 'vitest';
import type { PatientEntitlement } from '../types/packages';
import {
  completedTreatmentSessions,
  effectiveTreatmentTotal,
  groupActiveTreatmentPlans,
  nextTreatmentSession,
  treatmentSessionLabel,
} from './treatmentExecution';

const entitlement = (overrides: Partial<PatientEntitlement> = {}): PatientEntitlement => ({
  user_id: 'user',
  patient_id: 'patient',
  package_id: 'package-1',
  package_title: 'Protocolo acne',
  source_type: 'manual',
  source_proposal_version_id: null,
  source_deal_id: null,
  source_voucher_id: null,
  package_status: 'active',
  valid_from: null,
  valid_until: null,
  activated_at: '2026-08-29T12:00:00Z',
  package_item_id: 'item-1',
  service_id: 'service-1',
  service_name_snapshot: 'MMP',
  quantity_granted: 4,
  unit_label_snapshot: 'sessão',
  commercial_value_snapshot: 800,
  granted: 4,
  redeemed: 1,
  reversed: 0,
  adjusted: 0,
  raw_balance: 3,
  available_balance: 3,
  effective_status: 'active',
  ...overrides,
});

describe('treatment execution helpers', () => {
  it('shows the next session inside the purchased treatment', () => {
    const item = entitlement();
    expect(completedTreatmentSessions(item)).toBe(1);
    expect(effectiveTreatmentTotal(item)).toBe(4);
    expect(nextTreatmentSession(item)).toBe(2);
    expect(treatmentSessionLabel(item)).toBe('Sessão 2 de 4');
  });

  it('reuses the sequence after a reversed attendance', () => {
    const item = entitlement({ redeemed: 2, reversed: 1, available_balance: 3 });
    expect(completedTreatmentSessions(item)).toBe(1);
    expect(nextTreatmentSession(item)).toBe(2);
  });

  it('includes explicit credit adjustments in the treatment total', () => {
    const item = entitlement({ adjusted: 1, available_balance: 4 });
    expect(effectiveTreatmentTotal(item)).toBe(5);
    expect(treatmentSessionLabel(item)).toBe('Sessão 2 de 5');
  });

  it('groups only active plans with remaining sessions', () => {
    const rows = [
      entitlement(),
      entitlement({ package_item_id: 'item-2', service_id: 'service-2', service_name_snapshot: 'Peeling', quantity_granted: 2, granted: 2, redeemed: 0, available_balance: 2 }),
      entitlement({ package_id: 'package-2', package_title: 'Finalizado', package_item_id: 'item-3', service_id: 'service-3', quantity_granted: 1, granted: 1, redeemed: 1, available_balance: 0, effective_status: 'completed' }),
    ];
    const plans = groupActiveTreatmentPlans(rows);
    expect(plans).toHaveLength(1);
    expect(plans[0].title).toBe('Protocolo acne');
    expect(plans[0].totalSessions).toBe(6);
    expect(plans[0].completedSessions).toBe(1);
    expect(plans[0].remainingSessions).toBe(5);
  });
});
