import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ageLabel,
  birthDateIsoToInput,
  calculateAge,
  formatBirthDateInput,
  parseBirthDateInput,
} from './dateUtils';
import { agendaRange, clinicDateIso, clinicLocalToIso, displayEndTime } from './agendaTime';

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

describe('Agenda timezone America/Sao_Paulo', () => {
  it('keeps 14:00 with a 30 minute end time', () => {
    const start = clinicLocalToIso('2026-08-13', '14:00');
    expect(start).toBe('2026-08-13T17:00:00.000Z');
    expect(displayEndTime(start, 30)).toBe('14:30');
  });

  it('keeps midnight on the intended clinic date', () => {
    const start = clinicLocalToIso('2026-08-13', '00:00');
    expect(start).toBe('2026-08-13T03:00:00.000Z');
    expect(clinicDateIso(start)).toBe('2026-08-13');
  });

  it('keeps 23:30 on the intended clinic date across a month boundary', () => {
    const start = clinicLocalToIso('2026-08-31', '23:30');
    expect(start).toBe('2026-09-01T02:30:00.000Z');
    expect(clinicDateIso(start)).toBe('2026-08-31');
  });

  it('builds a daily half-open range in clinic timezone', () => {
    expect(agendaRange('2026-08-13', 'day')).toMatchObject({
      from: '2026-08-13T03:00:00.000Z',
      to: '2026-08-14T03:00:00.000Z',
    });
  });
});
