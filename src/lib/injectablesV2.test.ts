import { describe, expect, it } from 'vitest';
import type { InjectablePoint } from '../types';
import {
  applicationTotal,
  clampNormalized,
  formatQuantity,
  isPositiveQuantity,
  normalizeQuantityInput,
  summarizeLegacyInjectablePoints,
  sumDecimalQuantities,
  unitLabel,
  type InjectableApplicationDraftV2,
} from './injectablesV2';

describe('injectablesV2 decimal quantities', () => {
  it('sums toxin units without float drift', () => {
    expect(sumDecimalQuantities(['4', '4', '2'])).toBe('10');
  });

  it('sums decimal mL exactly', () => {
    expect(sumDecimalQuantities(['0.2', '0.3'])).toBe('0.5');
    expect(sumDecimalQuantities(['0.1', '0.2'])).toBe('0.3');
  });

  it('keeps different applications separate instead of summing unlike units', () => {
    const toxin: InjectableApplicationDraftV2 = {
      id: 'a', service_id: 's1', product_id: 'p1', lot_id: null, color: '#000', dilution_note: '',
      points: [
        { id: '1', x: 0.2, y: 0.3, quantity: '20', region: '', side: '', note: '' },
      ],
    };
    const filler: InjectableApplicationDraftV2 = {
      id: 'b', service_id: 's2', product_id: 'p2', lot_id: null, color: '#111', dilution_note: '',
      points: [
        { id: '2', x: 0.4, y: 0.5, quantity: '0.5', region: '', side: '', note: '' },
      ],
    };

    expect(applicationTotal(toxin)).toBe('20');
    expect(applicationTotal(filler)).toBe('0.5');
  });

  it('accepts positive decimal input and rejects zero', () => {
    expect(normalizeQuantityInput('0,25')).toBe('0.25');
    expect(normalizeQuantityInput('1.23456')).toBe('1.2345');
    expect(isPositiveQuantity('0.0001')).toBe(true);
    expect(isPositiveQuantity('0')).toBe(false);
    expect(formatQuantity('1.2300')).toBe('1.23');
  });
});

describe('injectablesV2 normalized coordinates', () => {
  it('keeps coordinates inside the responsive 0..1 space', () => {
    expect(clampNormalized(-1)).toBe(0);
    expect(clampNormalized(0.42)).toBe(0.42);
    expect(clampNormalized(2)).toBe(1);
  });
});

describe('injectablesV2 legacy compatibility', () => {
  it('never invents a missing historical unit', () => {
    const points = [
      {
        id: 'legacy',
        x: 0.5,
        y: 0.5,
        service_id: 'svc',
        service_name: 'Legado',
        color: '#000',
        quantity: 2,
        unit: '',
      },
    ] satisfies InjectablePoint[];

    const summary = summarizeLegacyInjectablePoints(points);
    expect(summary).toHaveLength(1);
    expect(summary[0].unit).toBeNull();
    expect(unitLabel(summary[0].unit)).toBe('Unidade não registrada');
  });

  it('groups the same service separately when historical units differ', () => {
    const points = [
      { id: '1', x: 0, y: 0, service_id: 'svc', service_name: 'Teste', color: '#000', quantity: 2, unit: 'U' },
      { id: '2', x: 0, y: 0, service_id: 'svc', service_name: 'Teste', color: '#000', quantity: 0.5, unit: 'mL' },
    ] satisfies InjectablePoint[];

    const summary = summarizeLegacyInjectablePoints(points);
    expect(summary.map(item => `${item.total} ${item.unit}`)).toEqual(['2 U', '0.5 mL']);
  });
});
