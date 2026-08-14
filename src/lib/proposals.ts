import { clinicDateIso } from './agendaTime';

export type ProposalStatus = 'draft' | 'issued' | 'accepted' | 'declined' | 'voided';
export type ProposalEffectiveStatus = ProposalStatus | 'expired';
export type ProposalDiscountType = 'none' | 'amount' | 'percent';

export const PROPOSAL_STATUS_LABEL: Record<ProposalEffectiveStatus, string> = {
  draft: 'Rascunho',
  issued: 'Emitida',
  expired: 'Expirada',
  accepted: 'Aceita',
  declined: 'Recusada',
  voided: 'Anulada',
};

export interface TreatmentProposal {
  id: string;
  user_id: string;
  deal_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface TreatmentProposalVersion {
  id: string;
  user_id: string;
  proposal_id: string;
  version_number: number;
  status: ProposalStatus;
  title: string;
  draft_revision: number;
  currency: 'BRL';
  recipient_snapshot: { name: string } | null;
  professional_snapshot: { display_name: string; profession?: string | null; professional_registration?: string | null } | null;
  payment_terms: string | null;
  internal_note: string | null;
  customer_note: string | null;
  subtotal: number;
  item_discount_amount: number;
  net_subtotal: number;
  discount_type: ProposalDiscountType;
  discount_value: number;
  discount_amount: number;
  total_value: number;
  valid_until: string | null;
  issued_at: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  voided_at: string | null;
  decline_reason: string | null;
  void_reason: string | null;
  supersedes_version_id: string | null;
  pdf_path: string | null;
  pdf_sha256: string | null;
  created_at: string;
  updated_at: string;
}

export interface TreatmentProposalItem {
  id: string;
  user_id: string;
  proposal_version_id: string;
  service_id: string | null;
  service_name_snapshot: string;
  description_snapshot: string | null;
  interval_note: string | null;
  quantity: number;
  unit_label: string;
  list_unit_price_snapshot: number;
  offered_unit_price: number;
  discount_type: ProposalDiscountType;
  discount_value: number;
  discount_amount: number;
  line_subtotal: number;
  line_total: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ProposalSummary {
  proposal_id: string;
  deal_id: string;
  proposal_name: string;
  version_id: string;
  version_number: number;
  status: ProposalStatus;
  effective_status: ProposalEffectiveStatus;
  title: string;
  total_value: number;
  valid_until: string | null;
  issued_at: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  pdf_path: string | null;
}

export interface ProposalEditorItem {
  key: string;
  service_id: string | null;
  service_name_snapshot: string;
  description_snapshot: string;
  interval_note: string;
  quantity: string;
  unit_label: string;
  list_unit_price_snapshot: string;
  offered_unit_price: string;
  discount_type: ProposalDiscountType;
  discount_value: string;
  sort_order: number;
}

function normalizeDecimal(value: number | string): string {
  const raw = typeof value === 'number' ? String(value) : value.trim().replace(',', '.');
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) throw new Error('PROPOSAL_INVALID_NUMBER');
  return raw;
}

function scaledInteger(value: number | string, scale: number): number {
  const raw = normalizeDecimal(value);
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole, fraction = ''] = unsigned.split('.');
  const padded = `${fraction}${'0'.repeat(scale + 1)}`;
  let result = Number(whole) * 10 ** scale + Number(padded.slice(0, scale) || 0);
  const next = Number(padded[scale] || 0);
  if (next >= 5) result += 1;
  return negative ? -result : result;
}

export function moneyToCents(value: number | string): number {
  return scaledInteger(value, 2);
}

export function centsToMoney(cents: number): number {
  return cents / 100;
}

export function quantityToMillis(value: number | string): number {
  return scaledInteger(value, 3);
}

export function discountAmountCents(baseCents: number, type: ProposalDiscountType, value: number | string): number {
  if (!Number.isInteger(baseCents) || baseCents < 0) throw new Error('PROPOSAL_INVALID_BASE');
  if (type === 'none') {
    if (scaledInteger(value || 0, 4) !== 0) throw new Error('PROPOSAL_NONE_DISCOUNT_VALUE');
    return 0;
  }
  if (type === 'amount') {
    const amount = moneyToCents(value || 0);
    if (amount < 0 || amount > baseCents) throw new Error('PROPOSAL_INVALID_AMOUNT_DISCOUNT');
    return amount;
  }
  const basisPoints = scaledInteger(value || 0, 2);
  if (basisPoints < 0 || basisPoints > 10_000) throw new Error('PROPOSAL_INVALID_PERCENT_DISCOUNT');
  return Math.round((baseCents * basisPoints) / 10_000);
}

export function calculateProposalItem(input: {
  quantity: number | string;
  offeredUnitPrice: number | string;
  discountType: ProposalDiscountType;
  discountValue: number | string;
}) {
  const quantityMillis = quantityToMillis(input.quantity);
  if (quantityMillis <= 0) throw new Error('PROPOSAL_INVALID_QUANTITY');
  const unitCents = moneyToCents(input.offeredUnitPrice);
  if (unitCents < 0) throw new Error('PROPOSAL_INVALID_PRICE');
  const subtotalCents = Math.round((quantityMillis * unitCents) / 1000);
  const discountCents = discountAmountCents(subtotalCents, input.discountType, input.discountValue);
  return {
    subtotalCents,
    discountCents,
    totalCents: subtotalCents - discountCents,
  };
}

export function calculateProposalTotals(items: Array<Parameters<typeof calculateProposalItem>[0]>, globalDiscountType: ProposalDiscountType, globalDiscountValue: number | string) {
  const lines = items.map(calculateProposalItem);
  const subtotalCents = lines.reduce((sum, line) => sum + line.subtotalCents, 0);
  const itemDiscountCents = lines.reduce((sum, line) => sum + line.discountCents, 0);
  const netSubtotalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
  const globalDiscountCents = discountAmountCents(netSubtotalCents, globalDiscountType, globalDiscountValue);
  return {
    subtotalCents,
    itemDiscountCents,
    netSubtotalCents,
    globalDiscountCents,
    totalCents: netSubtotalCents - globalDiscountCents,
  };
}

export function proposalEffectiveStatus(version: Pick<TreatmentProposalVersion, 'status' | 'valid_until'>, today = clinicDateIso()): ProposalEffectiveStatus {
  if (version.status === 'issued' && version.valid_until && version.valid_until < today) return 'expired';
  return version.status;
}

export function proposalMoney(value: number | string | null | undefined) {
  const numeric = Number(value ?? 0);
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number.isFinite(numeric) ? numeric : 0);
}

export function proposalDate(value: string | null | undefined) {
  if (!value) return '—';
  const [year, month, day] = value.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

export function proposalErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String((error as { message?: string } | null)?.message ?? '');
  if (/PROPOSAL_DRAFT_CONFLICT/i.test(message)) return 'Esta proposta foi alterada em outro dispositivo.';
  if (/PROPOSAL_EXPIRED_CREATE_REVISION|PROPOSAL_VALIDITY_EXPIRED/i.test(message)) return 'A validade terminou. Crie uma nova versão para continuar.';
  if (/PROPOSAL_DRAFT_ALREADY_EXISTS/i.test(message)) return 'Já existe uma versão em rascunho desta proposta.';
  if (/PROPOSAL_SERVICE_NOT_FOUND/i.test(message)) return 'Um dos serviços não está mais disponível para esta conta.';
  if (/PROPOSAL_SESSION_REQUIRED|JWT|session/i.test(message)) return 'Sua sessão expirou. Entre novamente.';
  if (/PROPOSAL_VERSION_IMMUTABLE|PROPOSAL_ACCEPTED_IMMUTABLE/i.test(message)) return 'Esta versão está congelada. Crie uma nova versão para alterar valores ou itens.';
  return message || 'Não foi possível concluir a ação.';
}
