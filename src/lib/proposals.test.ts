import { describe, expect, it } from 'vitest';
import {
  calculateProposalItem,
  calculateProposalTotals,
  discountAmountCents,
  moneyToCents,
  proposalEffectiveStatus,
  quantityToMillis,
} from './proposals';

describe('proposal money', () => {
  it('normalizes decimal money without binary-float math', () => {
    expect(moneyToCents('0.1')).toBe(10);
    expect(moneyToCents('10.235')).toBe(1024);
    expect(moneyToCents('1300')).toBe(130000);
  });

  it('normalizes quantity to thousandths', () => {
    expect(quantityToMillis('2')).toBe(2000);
    expect(quantityToMillis('1.5')).toBe(1500);
  });

  it('calculates 2 sessions x R$ 1.300', () => {
    expect(calculateProposalItem({ quantity: '2', offeredUnitPrice: '1300', discountType: 'none', discountValue: '0' }))
      .toEqual({ subtotalCents: 260000, discountCents: 0, totalCents: 260000 });
  });

  it('calculates amount discount', () => {
    expect(discountAmountCents(100000, 'amount', '100')).toBe(10000);
    expect(calculateProposalItem({ quantity: '1', offeredUnitPrice: '1000', discountType: 'amount', discountValue: '100' }).totalCents).toBe(90000);
  });

  it('calculates percentage discount', () => {
    expect(discountAmountCents(100000, 'percent', '10')).toBe(10000);
    expect(calculateProposalItem({ quantity: '1', offeredUnitPrice: '1000', discountType: 'percent', discountValue: '10' }).totalCents).toBe(90000);
  });

  it('rejects discount greater than the base', () => {
    expect(() => discountAmountCents(100000, 'amount', '1000.01')).toThrow('PROPOSAL_INVALID_AMOUNT_DISCOUNT');
  });

  it('rejects percentage above 100', () => {
    expect(() => discountAmountCents(100000, 'percent', '100.01')).toThrow('PROPOSAL_INVALID_PERCENT_DISCOUNT');
  });

  it('applies item discounts before global discount', () => {
    const totals = calculateProposalTotals([
      { quantity: '1', offeredUnitPrice: '1000', discountType: 'amount', discountValue: '100' },
      { quantity: '2', offeredUnitPrice: '500', discountType: 'none', discountValue: '0' },
    ], 'percent', '10');
    expect(totals).toEqual({
      subtotalCents: 200000,
      itemDiscountCents: 10000,
      netSubtotalCents: 190000,
      globalDiscountCents: 19000,
      totalCents: 171000,
    });
  });
});

describe('proposal effective status', () => {
  it('derives expired only from an issued version', () => {
    expect(proposalEffectiveStatus({ status: 'issued', valid_until: '2026-08-13' }, '2026-08-14')).toBe('expired');
    expect(proposalEffectiveStatus({ status: 'accepted', valid_until: '2026-08-13' }, '2026-08-14')).toBe('accepted');
    expect(proposalEffectiveStatus({ status: 'issued', valid_until: '2026-08-14' }, '2026-08-14')).toBe('issued');
  });
});
