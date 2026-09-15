import { describe, expect, it } from 'vitest';
import type { PatientEntitlement } from '../types/packages';
import {
  additionalTreatmentSessions,
  completedTreatmentSessions,
  effectiveTreatmentTotal,
  groupActiveTreatmentPlans,
  isClinicalExtensionSession,
  nextTreatmentSession,
  treatmentAdditionalLabel,
  treatmentProgressLabel,
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
  allow_clinical_extensions: true,
  clinically_finalized_at: null,
  clinically_finalized_reason: null,
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
  contracted_adjusted: 0,
  clinical_extension_adjusted: 0,
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

  it('uses only commercial plan adjustments in the contracted total', () => {
    const item = entitlement({ adjusted: 2, contracted_adjusted: 1, clinical_extension_adjusted: 1, available_balance: 4 });
    expect(effectiveTreatmentTotal(item)).toBe(5);
    expect(treatmentSessionLabel(item)).toBe('Sessão 2 de 5');
  });

  it('keeps an exhausted protocol selectable for a free clinical extension', () => {
    const item = entitlement({
      quantity_granted: 10,
      granted: 10,
      redeemed: 10,
      raw_balance: 0,
      available_balance: 1,
    });
    expect(isClinicalExtensionSession(item)).toBe(true);
    expect(nextTreatmentSession(item)).toBe(11);
    expect(treatmentSessionLabel(item)).toBe('Sessão 11 · 10 contratadas');
    expect(treatmentProgressLabel(item)).toBe('10 de 10 realizadas');
  });

  it('shows performed sessions beyond what was contracted without changing the contract', () => {
    const item = entitlement({
      quantity_granted: 10,
      granted: 10,
      redeemed: 11,
      adjusted: 1,
      contracted_adjusted: 0,
      clinical_extension_adjusted: 1,
      raw_balance: 0,
      available_balance: 1,
    });
    expect(effectiveTreatmentTotal(item)).toBe(10);
    expect(additionalTreatmentSessions(item)).toBe(1);
    expect(treatmentProgressLabel(item)).toBe('11 sessões realizadas · 10 contratadas');
    expect(treatmentAdditionalLabel(item)).toBe('+1 sessão adicional sem cobrança');
    expect(treatmentSessionLabel(item)).toBe('Sessão 12 · 10 contratadas');
  });

  it('groups active plans even after the contracted quantity is reached', () => {
    const rows = [
      entitlement(),
      entitlement({ package_item_id: 'item-2', service_id: 'service-2', service_name_snapshot: 'Peeling', quantity_granted: 2, granted: 2, redeemed: 0, available_balance: 2 }),
      entitlement({ package_id: 'package-2', package_title: 'Finalizado', package_item_id: 'item-3', service_id: 'service-3', quantity_granted: 1, granted: 1, redeemed: 1, available_balance: 0, effective_status: 'completed', clinically_finalized_at: '2026-09-15T01:00:00Z' }),
      entitlement({ package_id: 'package-3', package_title: 'Em continuidade', package_item_id: 'item-4', service_id: 'service-4', quantity_granted: 10, granted: 10, redeemed: 10, raw_balance: 0, available_balance: 1 }),
    ];
    const plans = groupActiveTreatmentPlans(rows);
    expect(plans).toHaveLength(2);
    expect(plans[0].title).toBe('Em continuidade');
    expect(plans[1].title).toBe('Protocolo acne');
    expect(plans[1].totalSessions).toBe(6);
    expect(plans[1].completedSessions).toBe(1);
    expect(plans[1].remainingSessions).toBe(5);
  });
});
