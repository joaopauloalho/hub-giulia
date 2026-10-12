import { describe, expect, it } from 'vitest';
import {
  compatibleInjectableProducts,
  injectableProductCategory,
  injectableServiceCategory,
} from './injectableProductCategory';

const product = (name: string, category: string | null = null, active = true) => ({ name, category, active });

describe('injectable product categories', () => {
  it('identifies the existing injectable service names regardless of accents and spaces', () => {
    expect(injectableServiceCategory('Bioestimulador de colágeno  ')).toBe('bioestimulador');
    expect(injectableServiceCategory('Toxina Botulina ')).toBe('toxina');
    expect(injectableServiceCategory('Toxina botulínica 1 área')).toBe('toxina');
    expect(injectableServiceCategory('Preenchimento com Ácido Hialurônico ')).toBe('preenchimento');
    expect(injectableServiceCategory('Mesoterapia')).toBe('outros');
  });

  it('separates the seven pre-existing uncategorized catalog products', () => {
    const products = [
      product('Belotero intense'), product('Biogelis Volumw'), product('Botox Allergan'),
      product('Botulift'), product('Dysport'), product('Rennova Diamond Intense'),
      product('Restylane Gel'),
    ];
    expect(compatibleInjectableProducts(products, 'Bioestimulador de colágeno')).toEqual([]);
    expect(compatibleInjectableProducts(products, 'Toxina Botulina').map(p => p.name))
      .toEqual(['Botox Allergan', 'Botulift', 'Dysport']);
    expect(compatibleInjectableProducts(products, 'Preenchimento com Ácido Hialurônico').map(p => p.name))
      .toEqual(['Belotero intense', 'Biogelis Volumw', 'Rennova Diamond Intense', 'Restylane Gel']);
  });

  it('prioritizes saved categories, excludes inactive and unclassified products', () => {
    const products = [
      product('Produto personalizado', 'bioestimulador'),
      product('Outro produto', null),
      product('Botox Allergan', 'preenchimento'),
      product('Sculptra', null, false),
    ];
    expect(compatibleInjectableProducts(products, 'Bioestimulador de colágeno').map(p => p.name))
      .toEqual(['Produto personalizado']);
    expect(compatibleInjectableProducts(products, 'Preenchimento com Ácido Hialurônico').map(p => p.name))
      .toEqual(['Botox Allergan']);
    expect(injectableProductCategory(product('Desconhecido'))).toBeNull();
  });

  it('categorizes new products according to an injectable service', () => {
    const item = product('Nova marca', injectableServiceCategory('Bioestimulador de colágeno'));
    expect(compatibleInjectableProducts([item], 'Bioestimulador de colágeno')).toEqual([item]);
    expect(compatibleInjectableProducts([item], 'Toxina Botulina')).toEqual([]);
  });
});
