import { addIsoDays, clinicDateIso } from './agendaTime';
import { normalizePhone } from './patientInput';
import { ACQUISITION_SOURCE_KEYS, ACQUISITION_SOURCE_LABEL, type AcquisitionSource } from './acquisition';

// Keep persisted keys stable for historical rows/analytics. `new` is legacy and no longer shown in the operational funnel.
export const CRM_STAGE_KEYS = ['new', 'contacted', 'assessment_scheduled', 'proposal_sent', 'negotiation', 'won', 'lost'] as const;
export type CrmStage = typeof CRM_STAGE_KEYS[number];
export const CRM_VISIBLE_STAGE_KEYS: CrmStage[] = ['contacted', 'assessment_scheduled', 'proposal_sent', 'negotiation', 'won', 'lost'];
export const CRM_VISIBLE_OPEN_STAGES: CrmStage[] = ['contacted', 'assessment_scheduled', 'proposal_sent', 'negotiation'];
// Stable persisted-data contract. New data no longer enters `new`, but old rows remain a valid open state.
export const CRM_OPEN_STAGES: CrmStage[] = ['new', ...CRM_VISIBLE_OPEN_STAGES];

export const CRM_STAGE_LABEL: Record<CrmStage, string> = {
  new: 'Novo lead',
  contacted: 'Em contato',
  assessment_scheduled: 'Avaliação',
  proposal_sent: 'Proposta enviada',
  negotiation: 'Negociação',
  won: 'Fechado',
  lost: 'Perdido',
};

export const CRM_SOURCE_KEYS = ACQUISITION_SOURCE_KEYS;
export type CrmSource = AcquisitionSource;
export const CRM_SOURCE_LABEL = ACQUISITION_SOURCE_LABEL;

export const CRM_LOSS_REASON_KEYS = ['price', 'postponed', 'no_response', 'competitor', 'not_interested', 'clinical_decision', 'other'] as const;
export type CrmLossReason = typeof CRM_LOSS_REASON_KEYS[number];
export const CRM_LOSS_REASON_LABEL: Record<CrmLossReason, string> = { price: 'Preço', postponed: 'Adiou', no_response: 'Sem resposta', competitor: 'Fechou com outro', not_interested: 'Sem interesse', clinical_decision: 'Decisão clínica', other: 'Outro' };

export const CRM_CHANNEL_KEYS = ['whatsapp', 'phone', 'instagram', 'other'] as const;
export type CrmChannel = typeof CRM_CHANNEL_KEYS[number];
export const CRM_CHANNEL_LABEL: Record<CrmChannel, string> = { whatsapp: 'WhatsApp', phone: 'Telefone', instagram: 'Instagram', other: 'Outro' };

export type FollowupBucket = 'overdue' | 'today' | 'upcoming';
export function followupBucket(dueOn: string | null, today = clinicDateIso()): FollowupBucket | null { if (!dueOn) return null; if (dueOn < today) return 'overdue'; if (dueOn === today) return 'today'; return 'upcoming'; }
export function followupShortcut(days: number, today = clinicDateIso()): string { return addIsoDays(today, days); }
export function isClosedCrmStage(stage: CrmStage): boolean { return stage === 'won' || stage === 'lost'; }
export function normalizeCrmPhone(value: string | null): string | null { return normalizePhone(value); }
export function normalizeCrmEmail(value: string | null): string | null { return value?.trim().toLowerCase() || null; }
export function formatCrmValue(value: number | string | null): string | null { if (value === null || value === '') return null; const parsed = typeof value === 'number' ? value : Number(value); if (!Number.isFinite(parsed)) return null; return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(parsed); }
export function createCrmIdempotencyKey(): string { return crypto.randomUUID(); }
export function safeCrmSearchTerm(value: string): string { return value.trim().replace(/[,%()]/g, ' ').replace(/\s+/g, ' ').trim(); }
