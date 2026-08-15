import { describe, expect, it } from 'vitest';
import { MAX_GLOBAL_SEARCH_QUERY, normalizeGlobalSearchQuery, shouldRunGlobalSearch } from './globalSearch';

describe('global search helpers', () => {
  it('normaliza espaços e limites', () => {
    expect(normalizeGlobalSearchQuery('  Maria   Silva  ')).toBe('Maria Silva');
    expect(normalizeGlobalSearchQuery('x'.repeat(200))).toHaveLength(MAX_GLOBAL_SEARCH_QUERY);
  });

  it('não executa busca vazia ou curta', () => {
    expect(shouldRunGlobalSearch('')).toBe(false);
    expect(shouldRunGlobalSearch(' M ')).toBe(false);
    expect(shouldRunGlobalSearch('Ma')).toBe(true);
  });
});
