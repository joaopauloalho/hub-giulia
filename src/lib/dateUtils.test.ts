import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ageLabel,
  birthDateIsoToInput,
  calculateAge,
  formatBirthDateInput,
  parseBirthDateInput,
} from './dateUtils';

describe('dateUtils', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-17T12:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats birth date input from mixed text', () => {
    expect(formatBirthDateInput('01022003abc')).toBe('01/02/2003');
    expect(formatBirthDateInput('0102')).toBe('01/02');
    expect(formatBirthDateInput('1')).toBe('1');
  });

  it('converts ISO dates to input format', () => {
    expect(birthDateIsoToInput('2003-02-01')).toBe('01/02/2003');
    expect(birthDateIsoToInput('2003-02-01T10:30:00Z')).toBe('01/02/2003');
    expect(birthDateIsoToInput(null)).toBe('');
  });

  it('parses valid input dates to ISO dates', () => {
    expect(parseBirthDateInput('01/02/2003')).toBe('2003-02-01');
    expect(parseBirthDateInput('17/06/2026')).toBe('2026-06-17');
  });

  it('rejects invalid or future birth dates', () => {
    expect(parseBirthDateInput('31/02/2003')).toBeNull();
    expect(parseBirthDateInput('01/01/1899')).toBeNull();
    expect(parseBirthDateInput('18/06/2026')).toBeNull();
    expect(parseBirthDateInput('2003-02-01')).toBeNull();
  });

  it('calculates age and label from ISO dates', () => {
    expect(calculateAge('2000-06-17')).toBe(26);
    expect(calculateAge('2000-06-18')).toBe(25);
    expect(calculateAge(null)).toBeNull();
    expect(ageLabel('2025-06-17')).toBe('1 ano');
    expect(ageLabel('2000-06-17')).toBe('26 anos');
  });
});
