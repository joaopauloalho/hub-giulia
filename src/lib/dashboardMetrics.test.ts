import { describe, expect, it } from 'vitest';
import {
  addIsoDays,
  clinicTodayIso,
  compareMetric,
  daysBetweenIso,
  getDashboardPeriod,
} from './dashboardMetrics';

describe('dashboard periods', () => {
  it('uses month-to-date in Sao Paulo and an exact previous period', () => {
    const period = getDashboardPeriod('month', '2026-08-14');
    expect(period.startDate).toBe('2026-08-01');
    expect(period.endDateExclusive).toBe('2026-08-15');
    expect(period.previousStartDate).toBe('2026-07-18');
    expect(period.previousEndDateExclusive).toBe('2026-08-01');
    expect(daysBetweenIso(period.startDate, period.endDateExclusive)).toBe(14);
    expect(daysBetweenIso(period.previousStartDate, period.previousEndDateExclusive)).toBe(14);
  });

  it('uses daily granularity for 7 and 30 days', () => {
    expect(getDashboardPeriod('7d', '2026-08-14').granularity).toBe('day');
    expect(getDashboardPeriod('30d', '2026-08-14').granularity).toBe('day');
  });

  it('builds a full previous calendar month', () => {
    const period = getDashboardPeriod('previous_month', '2026-08-14');
    expect(period.startDate).toBe('2026-07-01');
    expect(period.endDateExclusive).toBe('2026-08-01');
  });

  it('keeps custom end date inclusive in the UI and exclusive in SQL', () => {
    const period = getDashboardPeriod('custom', '2026-08-14', {
      startDate: '2026-08-03',
      endDateInclusive: '2026-08-05',
    });
    expect(period.startDate).toBe('2026-08-03');
    expect(period.endDateExclusive).toBe('2026-08-06');
    expect(period.previousStartDate).toBe('2026-07-31');
    expect(period.previousEndDateExclusive).toBe('2026-08-03');
  });

  it('rejects inverted custom periods', () => {
    expect(() => getDashboardPeriod('custom', '2026-08-14', {
      startDate: '2026-08-10',
      endDateInclusive: '2026-08-09',
    })).toThrow(/posterior/);
  });
});

describe('dashboard comparisons', () => {
  it('never emits Infinity when the previous period is zero', () => {
    const result = compareMetric(1000, 0);
    expect(result.label).toBe('Novo');
    expect(result.percentage).toBeNull();
  });

  it('returns a flat zero when both periods are zero', () => {
    expect(compareMetric(0, 0)).toMatchObject({ label: '0%', direction: 'flat' });
  });

  it('calculates finite positive and negative changes', () => {
    expect(compareMetric(120, 100)).toMatchObject({ percentage: 20, direction: 'up' });
    expect(compareMetric(80, 100)).toMatchObject({ percentage: -20, direction: 'down' });
  });
});

describe('clinic timezone', () => {
  it('classifies 00:30 UTC into the previous Sao Paulo calendar day', () => {
    expect(clinicTodayIso(new Date('2026-08-15T00:30:00.000Z'))).toBe('2026-08-14');
  });

  it('adds ISO days without browser timezone drift', () => {
    expect(addIsoDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addIsoDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
