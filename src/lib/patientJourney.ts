export const PATIENT_JOURNEY_MOMENTS = [
  'assessment_scheduled',
  'awaiting_quote',
  'quote_sent',
  'negotiation',
  'won_waiting_start',
  'in_treatment',
  'treatment_completed',
  'visited_not_closed',
  'unclassified',
] as const;

export type PatientJourneyMoment = typeof PATIENT_JOURNEY_MOMENTS[number];
export type PatientJourneyAttention = 'none' | 'warning' | 'urgent';
export type PatientJourneySource = 'automatic' | 'manual';

export const PATIENT_JOURNEY_LABEL: Record<PatientJourneyMoment, string> = {
  assessment_scheduled: 'Avaliação agendada',
  awaiting_quote: 'Aguardando orçamento',
  quote_sent: 'Orçamento enviado',
  negotiation: 'Em negociação',
  won_waiting_start: 'Fechou · aguardando início',
  in_treatment: 'Em tratamento',
  treatment_completed: 'Tratamento finalizado',
  visited_not_closed: 'Veio e não fechou',
  unclassified: 'Sem classificação',
};

export const PATIENT_JOURNEY_DESCRIPTION: Record<PatientJourneyMoment, string> = {
  assessment_scheduled: 'Ainda vai passar por avaliação ou primeira consulta.',
  awaiting_quote: 'A equipe precisa preparar ou enviar o orçamento.',
  quote_sent: 'Recebeu uma proposta e ainda não fechou.',
  negotiation: 'Está conversando sobre tratamento, condição ou valor.',
  won_waiting_start: 'Já fechou, mas ainda não iniciou o tratamento.',
  in_treatment: 'Está com sessões, retornos ou sequência de tratamento em andamento.',
  treatment_completed: 'Concluiu o ciclo atual e pode entrar em relacionamento/recorrência.',
  visited_not_closed: 'Compareceu, mas não contratou tratamento naquele momento.',
  unclassified: 'O Hub ainda não tem evidência suficiente para determinar o momento.',
};

export const PATIENT_JOURNEY_MANUAL_MOMENTS: PatientJourneyMoment[] = [
  'assessment_scheduled',
  'awaiting_quote',
  'quote_sent',
  'negotiation',
  'won_waiting_start',
  'in_treatment',
  'treatment_completed',
  'visited_not_closed',
];

export interface PatientJourneyRow {
  patient_id: string;
  patient_name: string;
  phone: string | null;
  profession: string | null;
  photo_url: string | null;
  moment: PatientJourneyMoment;
  moment_source: PatientJourneySource;
  moment_reason: string;
  moment_since: string | null;
  days_in_moment: number;
  attention_level: PatientJourneyAttention;
  next_action: string;
  deal_id: string | null;
  deal_stage: string | null;
  deal_title: string | null;
  proposal_version_id: string | null;
  proposal_title: string | null;
  proposal_total_value: number | null;
  proposal_status: string | null;
  proposal_valid_until: string | null;
  proposal_sent_at: string | null;
  available_balance: number;
  active_package_title: string | null;
  next_appointment_at: string | null;
  last_procedure_at: string | null;
  open_returns_count: number;
  followup_due_on: string | null;
  classification_debug: Record<string, unknown> | null;
}

export function normalizePatientJourneyRow(row: PatientJourneyRow): PatientJourneyRow {
  return {
    ...row,
    days_in_moment: Number(row.days_in_moment ?? 0),
    proposal_total_value: row.proposal_total_value == null ? null : Number(row.proposal_total_value),
    available_balance: Number(row.available_balance ?? 0),
    open_returns_count: Number(row.open_returns_count ?? 0),
  };
}

export function journeyAgeLabel(days: number): string {
  if (days <= 0) return 'hoje';
  if (days === 1) return 'há 1 dia';
  return `há ${days} dias`;
}

export function journeyAttentionLabel(level: PatientJourneyAttention): string | null {
  if (level === 'urgent') return 'Prioridade alta';
  if (level === 'warning') return 'Precisa de atenção';
  return null;
}

export function journeyMoney(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

export function journeyDateTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}

export function filterPatientJourneyRows(rows: PatientJourneyRow[], moment: PatientJourneyMoment | 'all', attentionOnly: boolean) {
  return rows.filter(row => (moment === 'all' || row.moment === moment) && (!attentionOnly || row.attention_level !== 'none'));
}
