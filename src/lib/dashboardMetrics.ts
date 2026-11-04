export const DASHBOARD_TIME_ZONE = 'America/Sao_Paulo';
export const DASHBOARD_EXPIRY_DAYS = 7;

export type DashboardPeriodPreset = 'today' | '7d' | '30d' | 'month' | 'previous_month' | 'custom';
export type DashboardGranularity = 'day' | 'week' | 'month';

export interface DashboardPeriod {
  preset: DashboardPeriodPreset;
  label: string;
  startDate: string;
  endDateExclusive: string;
  previousStartDate: string;
  previousEndDateExclusive: string;
  granularity: DashboardGranularity;
}

export interface DashboardAttention {
  today: string;
  expiry_days: number;
  agenda: {
    total: number;
    confirmed: number;
    pending: number;
    completed: number;
    cancelled: number;
    no_show: number;
    next_appointment: null | {
      id: string;
      patient_name: string;
      scheduled_at: string;
      service_name: string | null;
      status: string;
    };
  };
  crm_followups: { overdue: number; today: number };
  returns: { overdue: number; today: number; upcoming: number };
  payments: { overdue_count: number; overdue_value: number; today_count: number; today_value: number };
  proposals: { expiring_count: number; expiring_value: number };
  packages: { expiring_count: number; expiring_units: number };
}

export interface DashboardOverview {
  period: {
    start_date: string;
    end_date_exclusive: string;
    previous_start_date: string;
    previous_end_date_exclusive: string;
    timezone: string;
  };
  finance: {
    received_gross: number;
    fees: number;
    received_net: number;
    previous_received_gross: number;
    previous_fees: number;
    previous_received_net: number;
    pending_value: number;
    pending_count: number;
    overdue_value: number;
    overdue_count: number;
  };
  crm: {
    new_leads: number;
    previous_new_leads: number;
    new_opportunities: number;
    previous_new_opportunities: number;
    won: number;
    previous_won: number;
    lost: number;
    previous_lost: number;
    conversion_rate: number | null;
    previous_conversion_rate: number | null;
    pipeline_open_count: number;
    pipeline_open_value: number;
    pipeline_funnel: Record<'new' | 'contacted' | 'assessment_scheduled' | 'proposal_sent' | 'negotiation', number>;
  };
  proposals: {
    issued: number;
    sent: number;
    accepted: number;
    declined: number;
    expired: number;
    accepted_value: number;
    previous_accepted: number;
    previous_accepted_value: number;
    conversion_rate: number | null;
  };
  packages: {
    activated: number;
    previous_activated: number;
    credits_granted: number;
    previous_credits_granted: number;
    credits_redeemed: number;
    previous_credits_redeemed: number;
    credits_available: number;
    available_items: number;
    available_packages: number;
  };
  agenda: {
    appointments: number;
    completed: number;
    cancelled: number;
    no_show: number;
    attendance_rate: number | null;
    previous_attendance_rate: number | null;
  };
  clinical: {
    attendances: number;
    previous_attendances: number;
    production_value: number;
    previous_production_value: number;
    service_units: number;
    top_services: Array<{ name: string; quantity: number; attendances: number; production_value: number }>;
  };
  returns: { completed: number; previous_completed: number };
}

export interface DashboardSeriesPoint {
  bucket: string;
  gross: number;
  fees: number;
  net: number;
}

export interface MetricComparison {
  kind: 'flat' | 'new' | 'change';
  percentage: number | null;
  label: string;
  direction: 'up' | 'down' | 'flat';
}

function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addIsoDays(value: string, days: number): string {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

export function daysBetweenIso(start: string, endExclusive: string): number {
  return Math.round((parseIsoDate(endExclusive).getTime() - parseIsoDate(start).getTime()) / 86_400_000);
}

export function clinicTodayIso(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DASHBOARD_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function monthStart(value: string): string {
  return `${value.slice(0, 7)}-01`;
}

function previousMonthStart(value: string): string {
  const date = parseIsoDate(monthStart(value));
  date.setUTCMonth(date.getUTCMonth() - 1);
  return isoDate(date);
}

function nextMonthStart(value: string): string {
  const date = parseIsoDate(monthStart(value));
  date.setUTCMonth(date.getUTCMonth() + 1);
  return isoDate(date);
}

function granularityForDays(days: number): DashboardGranularity {
  if (days <= 31) return 'day';
  if (days <= 180) return 'week';
  return 'month';
}

function buildPeriod(
  preset: DashboardPeriodPreset,
  label: string,
  startDate: string,
  endDateExclusive: string,
): DashboardPeriod {
  const length = daysBetweenIso(startDate, endDateExclusive);
  if (length <= 0) throw new Error('Período inválido.');
  const previousEndDateExclusive = startDate;
  const previousStartDate = addIsoDays(startDate, -length);
  return {
    preset,
    label,
    startDate,
    endDateExclusive,
    previousStartDate,
    previousEndDateExclusive,
    granularity: granularityForDays(length),
  };
}

export function getDashboardPeriod(
  preset: DashboardPeriodPreset,
  today = clinicTodayIso(),
  custom?: { startDate: string; endDateInclusive: string },
): DashboardPeriod {
  switch (preset) {
    case 'today':
      return buildPeriod(preset, 'Hoje', today, addIsoDays(today, 1));
    case '7d':
      return buildPeriod(preset, '7 dias', addIsoDays(today, -6), addIsoDays(today, 1));
    case '30d':
      return buildPeriod(preset, '30 dias', addIsoDays(today, -29), addIsoDays(today, 1));
    case 'month':
      return buildPeriod(preset, 'Este mês', monthStart(today), addIsoDays(today, 1));
    case 'previous_month': {
      const start = previousMonthStart(today);
      return buildPeriod(preset, 'Mês anterior', start, nextMonthStart(start));
    }
    case 'custom': {
      if (!custom?.startDate || !custom.endDateInclusive) throw new Error('Informe as duas datas do período personalizado.');
      if (custom.startDate > custom.endDateInclusive) throw new Error('A data inicial não pode ser posterior à final.');
      return buildPeriod(preset, 'Personalizado', custom.startDate, addIsoDays(custom.endDateInclusive, 1));
    }
  }
}

export function compareMetric(current: number, previous: number): MetricComparison {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    return { kind: 'flat', percentage: null, label: '—', direction: 'flat' };
  }
  if (previous === 0) {
    if (current === 0) return { kind: 'flat', percentage: 0, label: '0%', direction: 'flat' };
    return { kind: 'new', percentage: null, label: 'Novo', direction: 'up' };
  }
  const percentage = ((current - previous) / Math.abs(previous)) * 100;
  const rounded = Math.round(percentage * 10) / 10;
  const direction = rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat';
  return {
    kind: 'change',
    percentage: rounded,
    label: `${rounded > 0 ? '+' : ''}${rounded.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`,
    direction,
  };
}

export function money(value: number): string {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function decimal(value: number, max = 1): string {
  return Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: max });
}

export function percent(value: number | null): string {
  return value == null ? '—' : `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

export function periodEndInclusive(period: DashboardPeriod): string {
  return addIsoDays(period.endDateExclusive, -1);
}
