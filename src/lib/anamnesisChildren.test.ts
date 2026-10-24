import { describe, expect, it } from 'vitest';
import {
  MAX_ANAMNESIS_CHILDREN,
  parseAnamnesisChildren,
  resizeAnamnesisChildren,
  summarizeAnamnesisChildren,
  updateAnamnesisChild,
} from './anamnesisChildren';

describe("optional children data in women's health anamnesis", () => {
  it('does not interpret corrupted or absent data as children', () => {
    expect(parseAnamnesisChildren(undefined)).toEqual([]);
    expect(parseAnamnesisChildren('not-json')).toEqual([]);
    expect(parseAnamnesisChildren('{"not":"a list"}')).toEqual([]);
  });

  it('resizes and preserves individual names and sexes', () => {
    let serialized = resizeAnamnesisChildren('', 2);
    serialized = updateAnamnesisChild(serialized, 2, 0, 'nome', 'Ana');
    serialized = updateAnamnesisChild(serialized, 2, 0, 'sexo', 'Feminino');
    serialized = updateAnamnesisChild(serialized, 2, 1, 'nome', 'Caio');
    expect(parseAnamnesisChildren(serialized)).toEqual([
      { nome: 'Ana', sexo: 'Feminino' },
      { nome: 'Caio', sexo: '' },
    ]);
    expect(summarizeAnamnesisChildren(serialized)).toBe('Filho(a) 1: Ana · Feminino\nFilho(a) 2: Caio');
    expect(parseAnamnesisChildren(resizeAnamnesisChildren(serialized, 1))).toEqual([
      { nome: 'Ana', sexo: 'Feminino' },
    ]);
  });

  it('limits the number of records and ignores out-of-range updates', () => {
    const serialized = resizeAnamnesisChildren('', MAX_ANAMNESIS_CHILDREN + 10);
    expect(parseAnamnesisChildren(serialized)).toHaveLength(MAX_ANAMNESIS_CHILDREN);
    const unchanged = updateAnamnesisChild(serialized, MAX_ANAMNESIS_CHILDREN, 50, 'nome', 'Invalid');
    expect(unchanged).toEqual(serialized);
  });
});
