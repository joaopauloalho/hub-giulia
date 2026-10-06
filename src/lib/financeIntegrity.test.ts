import { describe, expect, it } from 'vitest';
import type { Procedure } from '../types';
import { getProcedureFinancials, summarizeFinance } from './financeIntegrity';

function procedure(overrides: Partial<Procedure>): Procedure {
  return {
    id: 'proc-1',
    user_id: 'user-1',
    patient_id: 'patient-1',
    appointment_id: null,
    performed_at: '2026-10-05T12:00:00.000Z',
    services_ids: ['service-1'],
    total_value: 1249,
    total_cost: 350,
    clinical_minutes: 0,
    clinical_hourly_rate_snapshot: 0,
    clinical_time_cost: 0,
    clinical_cost_applied: false,
    payment_method: 'split',
    card_fee_pct: null,
    card_fee_value: null,
    net_value: 0,
    notes: null,
    created_at: '2026-10-05T12:00:00.000Z',
    ...overrides,
  };
}

describe('financeIntegrity barter accounting', () => {
  it('keeps barter separate from actual money received', () => {
    const proc = procedure({
      barter_value: 700,
      payments: [{
        id: 'pay-1',
        procedure_id: 'proc-1',
        user_id: 'user-1',
        method: 'pix',
        amount: 549,
        card_brand: null,
        installments: 1,
        fee_pct: null,
        fee_value: 0,
        net_amount: 549,
        absorve_taxa: true,
        scheduled_date: null,
        paid_at: '2026-10-05T12:00:00.000Z',
        created_at: '2026-10-05T12:00:00.000Z',
      }],
    });

    expect(getProcedureFinancials(proc)).toMatchObject({
      venda: 1249,
      pago: 549,
      permuta: 700,
      liquido: 549,
      pendente: 0,
      custo: 350,
      lucro: 199,
    });
  });

  it('supports full barter without inventing a cash receipt', () => {
    const proc = procedure({ barter_value: 1249, payments: [] });
    const values = getProcedureFinancials(proc);
    expect(values.pago).toBe(0);
    expect(values.permuta).toBe(1249);
    expect(values.pendente).toBe(0);

    const summary = summarizeFinance([proc]);
    expect(summary.vendas).toBe(1249);
    expect(summary.pago).toBe(0);
    expect(summary.permuta).toBe(1249);
  });
});
