import { describe, expect, it } from 'vitest';
import { brazilianDateToIso, normalizeBrazilianDateInput } from './dateInput';

describe('Brazilian date input', () => {
  it('formats digits while the user types', () => {
    expect(normalizeBrazilianDateInput('2')).toBe('2');
    expect(normalizeBrazilianDateInput('2310')).toBe('23/10');
    expect(normalizeBrazilianDateInput('23102027')).toBe('23/10/2027');
    expect(normalizeBrazilianDateInput('23/10/2027')).toBe('23/10/2027');
  });

  it('converts a valid Brazilian date to ISO', () => {
    expect(brazilianDateToIso('23/10/2027')).toBe('2027-10-23');
    expect(brazilianDateToIso('29/02/2028')).toBe('2028-02-29');
  });

  it('rejects incomplete and impossible dates', () => {
    expect(brazilianDateToIso('23/10')).toBeNull();
    expect(brazilianDateToIso('31/02/2027')).toBeNull();
    expect(brazilianDateToIso('29/02/2027')).toBeNull();
    expect(brazilianDateToIso('00/10/2027')).toBeNull();
  });
});
