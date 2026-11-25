import { describe, expect, it } from 'vitest';
import { visibleNav, APP_NAV } from './appNav';
import { birthdayOnInYear, birthdayTiming, nextBirthdayOn } from './birthdays';
import { DEFAULT_COMMUNICATION_TEMPLATES } from './communications';
import { buildCallRows, buildChargeRows, buildLaunchRows, previewRows } from './hoje';
import { DEFAULT_REACTIVATION_DAYS, DEFAULT_RELATIONSHIP_PREFERENCES } from './relationship';
import { rankReferrers, referralStatus } from './referrals';
import { cohortLabel, formatShare, originLabel, retentionRates } from './retention';

describe('clinic home', () => {
  it('uses a 45 day reactivation default and keeps a saved value in charge of the screen', () => {
    expect(DEFAULT_REACTIVATION_DAYS).toBe(45);
    expect(DEFAULT_RELATIONSHIP_PREFERENCES.reactivation_after_days).toBe(45);
  });

  it('hides unused modules and keeps Retenção and Indicações in the menu', () => {
    const hidden = visibleNav(APP_NAV, false).map(item => item.label);
    expect(hidden).not.toContain('Agenda');
    expect(hidden).not.toContain('Comunicação');
    expect(hidden).toContain('Hoje');
    expect(hidden).toContain('Indicações');
    expect(hidden).toContain('Retenção');
    expect(visibleNav(APP_NAV, true).map(item => item.label)).toEqual(expect.arrayContaining(['Agenda', 'Comunicação']));
  });

  it('lists only recent visits that already happened and previews five', () => {
    const now = new Date('2026-11-25T15:00:00-03:00');
    const rows = buildLaunchRows([
      { id: 'future', name: 'Amanhã', at: '2026-11-26T10:00:00-03:00', patientId: 'p1' },
      { id: 'today', name: 'Maria', at: '2026-11-25T09:00:00-03:00', patientId: 'p1' },
      { id: 'old', name: 'Antiga', at: '2026-10-01T09:00:00-03:00', patientId: null },
      { id: 'loose', name: 'iCloud', at: '2026-11-24T11:00:00-03:00', patientId: null },
    ], '2026-11-25', now);
    expect(rows.map(row => row.id)).toEqual(['today', 'loose']);
    expect(rows[0]?.actionLabel).toBe('Registrar');
    expect(rows[1]?.actionLabel).toBe('Agenda');
    expect(previewRows([1, 2, 3, 4, 5, 6]).hidden).toBe(1);
    expect(previewRows([1, 2, 3, 4, 5, 6], 5, true).rows).toHaveLength(6);
  });

  it('orders calls as overdue return, window, follow-up and birthday', () => {
    const rows = buildCallRows({
      todayIso: '2026-11-25',
      returns: [
        { id: 'due', patientId: 'p', name: 'Bia', phone: '11999999999', serviceName: 'Limpeza', returnType: 'clinical_return', windowEnd: '2026-11-30', overdue: false },
        { id: 'late', patientId: 'p', name: 'Ana', phone: '11988888888', serviceName: 'Toxina', returnType: 'next_session', windowEnd: '2026-11-01', overdue: true },
      ],
      followups: [
        { id: 'f', name: 'Cris', phone: '11977777777', patientId: null, dueOn: '2026-11-25' },
        { id: 'later', name: 'Depois', phone: null, patientId: null, dueOn: '2026-12-01' },
      ],
      birthdays: [{ patientId: 'b', name: 'Dora', phone: '11966666666' }],
    });
    expect(rows.map(row => row.id)).toEqual(['return:late', 'return:due', 'followup:f', 'birthday:b']);
    expect(rows[0].returnId).toBe('late');
    expect(rows[0].message).toContain('Ana');
    expect(rows[3].message).toContain('Dora');
    expect(rows[3]?.message?.toLowerCase() ?? '').not.toContain('desconto');
  });

  it('groups pending charges by patient', () => {
    const rows = buildChargeRows([
      { patientId: 'a', name: 'Ana', amount: 100, count: 1 },
      { patientId: 'b', name: 'Bia', amount: 40, count: 2 },
    ]);
    expect(rows[0].name).toBe('Ana');
    expect(rows[1].detail).toContain('2 cobranças');
    expect(rows[0].href).toBe('/pacientes/a?tab=finance');
  });

  it('knows birthdays today, this week and 29 de fevereiro', () => {
    expect(birthdayTiming('1992-11-25', '2026-11-25')).toBe('today');
    expect(birthdayTiming('1992-11-28', '2026-11-25')).toBe('week');
    expect(birthdayTiming('1992-01-02', '2026-11-25')).toBeNull();
    expect(nextBirthdayOn('1992-02-29', '2026-03-01')).toBe('2027-02-28');
    expect(birthdayOnInYear(2024, 2, 29)).toBe('2024-02-29');
  });

  it('keeps the birthday template warm and free of discounts', () => {
    const text = DEFAULT_COMMUNICATION_TEMPLATES.birthday_greeting.toLowerCase();
    expect(text).toContain('aniversário');
    expect(text).not.toMatch(/desconto|%\s*off|cupom|promo/);
  });

  it('moves a referral from indicated to scheduled to paying client', () => {
    expect(referralStatus({ referredPatientId: null, hasPaid: false, hasAppointment: false })).toBe('indicada');
    expect(referralStatus({ referredPatientId: 'p', hasPaid: false, hasAppointment: true })).toBe('agendou');
    expect(referralStatus({ referredPatientId: 'p', hasPaid: true, hasAppointment: false })).toBe('cliente');
    const ranking = rankReferrers([
      { referrerKey: 'a', referrerLabel: 'Ana', status: 'cliente' },
      { referrerKey: 'b', referrerLabel: 'Bia', status: 'indicada' },
      { referrerKey: 'a', referrerLabel: 'Ana', status: 'agendou' },
    ]);
    expect(ranking[0]).toMatchObject({ name: 'Ana', count: 2, clients: 1 });
  });

  it('bases retention shares on paid customers, not list price', () => {
    const rates = retentionRates(19, 5, 1000, 790);
    expect(formatShare(rates.oneTimeShare)).toBe('74%');
    expect(formatShare(rates.returnRate)).toBe('26%');
    expect(formatShare(rates.returningRevenueShare)).toBe('79%');
    expect(retentionRates(0, 0, 0, 0).returnRate).toBeNull();
    expect(originLabel('referral')).toBe('Indicação');
    expect(originLabel(null)).toBe('Não informado');
    expect(cohortLabel('2026-04')).toMatch(/abr/i);
  });
});
