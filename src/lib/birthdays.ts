import { daysBetweenIso } from './returnStatus';

export const BIRTHDAY_WEEK_DAYS = 7;

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function birthdayOnInYear(year: number, month: number, day: number): string {
  const clamped = Math.min(day, lastDayOfMonth(year, month));
  return `${year}-${String(month).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`;
}

export function nextBirthdayOn(birthDate: string, todayIso: string): string | null {
  const birth = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  const today = /^(\d{4})-(\d{2})-(\d{2})$/.exec(todayIso);
  if (!birth || !today) return null;
  const month = Number(birth[2]);
  const day = Number(birth[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const year = Number(today[1]);
  const thisYear = birthdayOnInYear(year, month, day);
  if (thisYear >= todayIso) return thisYear;
  return birthdayOnInYear(year + 1, month, day);
}

export type BirthdayTiming = 'today' | 'week';

export function birthdayTiming(birthDate: string | null | undefined, todayIso: string): BirthdayTiming | null {
  if (!birthDate) return null;
  const next = nextBirthdayOn(birthDate, todayIso);
  if (!next) return null;
  const days = daysBetweenIso(todayIso, next);
  if (days === 0) return 'today';
  if (days > 0 && days <= BIRTHDAY_WEEK_DAYS) return 'week';
  return null;
}
