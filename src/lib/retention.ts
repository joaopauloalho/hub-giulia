import { ACQUISITION_SOURCE_LABEL, type AcquisitionSource } from './acquisition';

export type RetentionRates = {
  returnRate: number | null;
  oneTimeShare: number | null;
  returningRevenueShare: number | null;
};

export function retentionRates(customers: number, returningCustomers: number, paidTotal: number, returningPaidTotal: number): RetentionRates {
  return {
    returnRate: customers > 0 ? returningCustomers / customers : null,
    oneTimeShare: customers > 0 ? (customers - returningCustomers) / customers : null,
    returningRevenueShare: paidTotal > 0 ? returningPaidTotal / paidTotal : null,
  };
}

export function originLabel(source: string | null | undefined): string {
  if (!source || source === 'not_informed') return 'Não informado';
  if (source in ACQUISITION_SOURCE_LABEL) return ACQUISITION_SOURCE_LABEL[source as AcquisitionSource];
  return source;
}

export function cohortLabel(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date).replace('.', '');
}

export function formatShare(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 0 }).format(value);
}
