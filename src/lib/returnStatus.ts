export type ReturnTemporalStatus = 'waiting' | 'available' | 'due_soon' | 'overdue';
export type ReturnOperationalStatus = 'open' | 'contacted' | 'scheduled' | 'completed' | 'dismissed';

export interface ReturnStateInput {
  windowStart: string;
  windowEnd: string;
  contactedAt?: string | null;
  appointmentId?: string | null;
  appointmentStatus?: string | null;
  completedAt?: string | null;
  dismissedAt?: string | null;
}

const CLINIC_TIME_ZONE = 'America/Sao_Paulo';

function datePartsInClinic(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CLINIC_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? '';
  return { year: get('year'), month: get('month'), day: get('day') };
}

export function clinicTodayIso(now = new Date()): string {
  const { year, month, day } = datePartsInClinic(now);
  return `${year}-${month}-${day}`;
}

function utcDayNumber(isoDate: string): number {
  const [year, month, day] = isoDate.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

export function daysBetweenIso(from: string, to: string): number {
  return utcDayNumber(to) - utcDayNumber(from);
}

export function classifyReturnWindow(
  windowStart: string,
  windowEnd: string,
  today = clinicTodayIso(),
): ReturnTemporalStatus {
  if (today < windowStart) return 'waiting';
  if (today > windowEnd) return 'overdue';
  return daysBetweenIso(today, windowEnd) <= 3 ? 'due_soon' : 'available';
}

export function classifyReturnOperation(input: ReturnStateInput): ReturnOperationalStatus {
  if (input.completedAt) return 'completed';
  if (input.dismissedAt) return 'dismissed';
  if (input.appointmentId && input.appointmentStatus !== 'cancelado') return 'scheduled';
  if (input.contactedAt) return 'contacted';
  return 'open';
}

export function returnNeedsAttention(input: ReturnStateInput, today = clinicTodayIso()): boolean {
  const operation = classifyReturnOperation(input);
  if (operation === 'completed' || operation === 'dismissed' || operation === 'scheduled') return false;
  const temporal = classifyReturnWindow(input.windowStart, input.windowEnd, today);
  return temporal === 'available' || temporal === 'due_soon' || temporal === 'overdue';
}

export function returnStatusLabel(
  temporal: ReturnTemporalStatus,
  operational: ReturnOperationalStatus,
): string {
  if (operational === 'completed') return 'Concluído';
  if (operational === 'dismissed') return 'Dispensado';
  if (operational === 'scheduled') return 'Agendado';
  if (temporal === 'overdue') return 'Atrasado';
  if (temporal === 'due_soon') return 'Prazo próximo';
  if (temporal === 'available') return 'Na janela';
  return 'Aguardando';
}

export function formatClinicDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
