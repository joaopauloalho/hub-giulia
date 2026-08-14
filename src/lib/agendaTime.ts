export const CLINIC_TIME_ZONE = 'America/Sao_Paulo';

const DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: CLINIC_TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
});

function partsInClinic(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CLINIC_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value ?? 0);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

function clinicOffsetMs(date: Date) {
  const p = partsInClinic(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

export function clinicLocalToIso(dateIso: string, time: string) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) throw new Error('Data ou horário inválido.');
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour > 23 || minute > 59) throw new Error('Horário inválido.');

  const wallClockUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let instant = new Date(wallClockUtc);
  for (let i = 0; i < 2; i += 1) {
    instant = new Date(wallClockUtc - clinicOffsetMs(instant));
  }

  const p = partsInClinic(instant);
  if (p.year !== year || p.month !== month || p.day !== day || p.hour !== hour || p.minute !== minute) {
    throw new Error('Horário inexistente no fuso da clínica.');
  }
  return instant.toISOString();
}

export function clinicDateIso(instant: string | Date = new Date()) {
  return DATE_FMT.format(typeof instant === 'string' ? new Date(instant) : instant);
}

export function clinicTime(instant: string | Date) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: CLINIC_TIME_ZONE,
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(typeof instant === 'string' ? new Date(instant) : instant);
}

export function clinicDateLabel(instant: string | Date, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: CLINIC_TIME_ZONE,
    ...(options ?? { day: '2-digit', month: '2-digit', year: 'numeric' }),
  }).format(typeof instant === 'string' ? new Date(instant) : instant);
}

export function addIsoDays(dateIso: string, days: number) {
  const [year, month, day] = dateIso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return date.toISOString().slice(0, 10);
}

export function startOfClinicWeek(dateIso: string) {
  const [year, month, day] = dateIso.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  const offset = weekday === 0 ? -6 : 1 - weekday;
  return addIsoDays(dateIso, offset);
}

export function startOfClinicMonth(dateIso: string) {
  return `${dateIso.slice(0, 7)}-01`;
}

export function addIsoMonths(dateIso: string, months: number) {
  const [year, month] = dateIso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, 1, 12));
  return date.toISOString().slice(0, 10);
}

export function agendaRange(anchorDate: string, view: 'day' | 'week' | 'month') {
  const fromDate = view === 'day' ? anchorDate : view === 'week' ? startOfClinicWeek(anchorDate) : startOfClinicMonth(anchorDate);
  const toDate = view === 'day' ? addIsoDays(fromDate, 1) : view === 'week' ? addIsoDays(fromDate, 7) : addIsoMonths(fromDate, 1);
  return {
    fromDate,
    toDate,
    from: clinicLocalToIso(fromDate, '00:00'),
    to: clinicLocalToIso(toDate, '00:00'),
  };
}

export function endIso(startIso: string, durationMinutes: number) {
  return new Date(new Date(startIso).getTime() + durationMinutes * 60_000).toISOString();
}

export function displayEndTime(startIso: string, durationMinutes: number) {
  return clinicTime(endIso(startIso, durationMinutes));
}
