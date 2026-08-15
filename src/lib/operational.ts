export type OperationalAttentionItem = {
  attention_key: string;
  priority_class: string;
  priority_rank: number;
  category: string;
  source_type: string;
  source_id: string;
  patient_id: string | null;
  contact_id: string | null;
  person_name: string;
  title: string;
  subtitle: string;
  due_at: string | null;
  source_priority: string;
  route: string;
  action_type: string;
  action_label: string;
  action_route: string;
};

export type OperationalAttentionCounts = {
  total: number;
  overdue: number;
  return: number;
  aftercare: number;
  confirmation: number;
  communication: number;
  relationship: number;
};

export type OperationalDaySummary = {
  day: string;
  agenda: { total: number; confirmed: number; pending: number; completed: number };
  next_appointment: null | {
    id: string;
    patient_id: string;
    patient_name: string;
    service_name: string | null;
    scheduled_at: string;
    status: string;
    route: string;
    agenda_route: string;
  };
  procedures_performed: number;
  pending_payment: number;
  future_returns_30d: number;
  attention_total: number;
  aftercare_attention: number;
  overdue_returns: number;
  relationship_attention: number;
};

export type OperationalWeekSummary = {
  start: string;
  end_exclusive: string;
  appointments: number;
  overdue_returns: number;
  aftercare: number;
  relationship: number;
  expiring_credits: number;
};

export type PatientNextAction = {
  source_type: string;
  source_id: string;
  title: string;
  due_at: string | null;
  action_type: string;
  action_label: string;
  route: string;
  priority_rank: number;
};

export type DataQualitySummary = {
  critical: number;
  warning: number;
  info: number;
  possible_duplicate: number;
  incomplete_data: number;
  orphan_or_inconsistency: number;
};

export type DataQualityIssue = {
  issue_key: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  category: string;
  patient_id: string | null;
  related_patient_id: string | null;
  title: string;
  detail: string;
  route: string;
  source_type: string;
  source_id: string;
  created_at: string;
};

export type PossibleDuplicatePair = {
  issue_key: string;
  patient_a_id: string;
  patient_b_id: string;
  patient_a_name: string;
  patient_b_name: string;
  patient_a_phone: string | null;
  patient_b_phone: string | null;
  patient_a_email: string | null;
  patient_b_email: string | null;
  patient_a_cpf_masked: string | null;
  patient_b_cpf_masked: string | null;
  patient_a_birth_date: string | null;
  patient_b_birth_date: string | null;
  patient_a_last_appointment_at: string | null;
  patient_b_last_appointment_at: string | null;
  patient_a_created_at: string;
  patient_b_created_at: string;
  match_cpf: boolean;
  match_phone: boolean;
  match_email: boolean;
  confidence_weight: number;
};

export const emptyAttentionCounts: OperationalAttentionCounts = {
  total: 0, overdue: 0, return: 0, aftercare: 0, confirmation: 0, communication: 0, relationship: 0,
};

export const emptyQualitySummary: DataQualitySummary = {
  critical: 0, warning: 0, info: 0, possible_duplicate: 0, incomplete_data: 0, orphan_or_inconsistency: 0,
};

export function attentionCategoryLabel(category: string): string {
  return ({ return: 'Retorno', aftercare: 'Pós-atendimento', confirmation: 'Confirmação', crm: 'Comunicação', proposal: 'Proposta', package: 'Crédito', relationship: 'Relacionamento' } as Record<string, string>)[category] ?? 'Atenção';
}

export function appendReturnTo(route: string, returnTo: string): string {
  if (!route.startsWith('/pacientes/')) return route;
  const [path, query = ''] = route.split('?');
  const params = new URLSearchParams(query);
  params.set('return_to', returnTo);
  return `${path}?${params.toString()}`;
}
