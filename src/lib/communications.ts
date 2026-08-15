export const COMMUNICATION_TEMPLATE_KEYS = [
  'appointment_confirmation',
  'crm_followup',
  'proposal_followup',
  'procedure_return',
  'package_expiry',
  'aftercare_instructions',
  'post_procedure_checkin',
  'relationship_reactivation',
] as const;

export type CommunicationTemplateKey = typeof COMMUNICATION_TEMPLATE_KEYS[number];
export type CommunicationCategory = 'confirmation' | 'crm' | 'return' | 'proposal' | 'package' | 'aftercare';
export type CommunicationPriority = 'overdue' | 'today' | 'tomorrow' | 'upcoming';
export type CommunicationSourceType = 'appointment' | 'crm_followup' | 'procedure_return' | 'proposal_version' | 'package' | 'procedure_followup_plan' | 'procedure_followup_task' | 'relationship_patient';

export type CommunicationContext = {
  scheduled_at?: string;
  deal_id?: string;
  deal_title?: string;
  due_on?: string;
  window_start?: string;
  window_end?: string;
  return_type?: string;
  proposal_id?: string;
  proposal_title?: string;
  total_value?: number | string;
  sent_at?: string;
  valid_until?: string;
  package_title?: string;
  remaining_credits?: number | string;
  procedure_id?: string;
  performed_on?: string;
  aftercare_instructions?: string;
  task_type?: string;
  task_label?: string;
  requires_professional_review?: boolean;
  photo_followup?: boolean;
};

export type CommunicationAttentionItem = {
  item_key: string;
  category: CommunicationCategory;
  source_type: CommunicationSourceType;
  source_id: string;
  patient_id: string | null;
  contact_id: string | null;
  display_name: string;
  phone: string | null;
  due_at: string | null;
  event_at: string | null;
  reason: string;
  priority: CommunicationPriority;
  template_key: CommunicationTemplateKey;
  context: CommunicationContext;
  target_route: string;
  last_contacted_at: string | null;
  snoozed_until: string | null;
};

export type CommunicationCounts = {
  total: number;
  confirmation: number;
  crm: number;
  return: number;
  proposal: number;
  package: number;
  aftercare: number;
  overdue: number;
  today: number;
};

export type CommunicationPreferences = {
  confirmation_lead_hours: number;
  proposal_followup_days: number;
  package_expiry_days: number;
};

export const DEFAULT_COMMUNICATION_PREFERENCES: CommunicationPreferences = {
  confirmation_lead_hours: 36,
  proposal_followup_days: 2,
  package_expiry_days: 15,
};

export const DEFAULT_COMMUNICATION_TEMPLATES: Record<CommunicationTemplateKey, string> = {
  appointment_confirmation: 'Oi, {first_name}! Tudo bem? Passando para confirmar seu horário em {date}, às {time}. Posso deixar confirmado para você?',
  crm_followup: 'Oi, {first_name}! Tudo bem? Passando para saber se ficou alguma dúvida e se posso te ajudar em algo.',
  proposal_followup: 'Oi, {first_name}! Tudo bem? Conseguiu dar uma olhadinha no plano que te enviei? Se ficou alguma dúvida, estou por aqui.',
  procedure_return: 'Oi, {first_name}! Tudo bem? Já estamos no período do seu retorno e queria combinar um horário com você.',
  package_expiry: 'Oi, {first_name}! Tudo bem? Você ainda tem {remaining_credits} crédito(s) disponível(is) no seu plano, com validade até {valid_until}. Se quiser, podemos organizar seu próximo horário.',
  aftercare_instructions: 'Oi, {first_name}! Tudo bem? Seguem as orientações combinadas no seu atendimento:\n\n{aftercare_instructions}\n\nQualquer dúvida, estou à disposição.',
  post_procedure_checkin: 'Oi, {first_name}! Tudo bem? Passando para saber como você está após o seu atendimento. Está tudo correndo bem?',
  relationship_reactivation: 'Oi, {first_name}! Tudo bem? Faz um tempinho que não nos vemos e passei para saber como você está. Se precisar de alguma coisa, estou por aqui.',
};

export const COMMUNICATION_PLACEHOLDERS = [
  'first_name',
  'name',
  'date',
  'time',
  'clinic_name',
  'proposal_title',
  'valid_until',
  'package_title',
  'remaining_credits',
  'aftercare_instructions',
] as const;

export type CommunicationPlaceholder = typeof COMMUNICATION_PLACEHOLDERS[number];

const PLACEHOLDER_SET = new Set<string>(COMMUNICATION_PLACEHOLDERS);
const PLACEHOLDER_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export const CATEGORY_LABEL: Record<CommunicationCategory, string> = {
  confirmation: 'Confirmações',
  crm: 'CRM',
  return: 'Retornos',
  proposal: 'Propostas',
  package: 'Pacotes',
  aftercare: 'Pós-atendimento',
};

export const TEMPLATE_LABEL: Record<CommunicationTemplateKey, string> = {
  appointment_confirmation: 'Confirmação de horário',
  crm_followup: 'Follow-up CRM',
  proposal_followup: 'Follow-up de proposta',
  procedure_return: 'Retorno',
  package_expiry: 'Pacote próximo da validade',
  aftercare_instructions: 'Orientações pós-atendimento',
  post_procedure_checkin: 'Check-in pós-atendimento',
  relationship_reactivation: 'Relacionamento / reativação',
};

export const PRIORITY_LABEL: Record<CommunicationPriority, string> = {
  overdue: 'Atrasado',
  today: 'Hoje',
  tomorrow: 'Amanhã',
  upcoming: 'Próximo',
};

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || 'Paciente';
}

export function formatCommunicationDate(value?: string | null): string {
  if (!value) return '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00-03:00`)
    : new Date(value);
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
  }).format(date);
}

export function formatCommunicationTime(value?: string | null): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function templateVariables(item: CommunicationAttentionItem, clinicName = ''): Record<CommunicationPlaceholder, string> {
  const event = item.event_at ?? item.due_at;
  return {
    first_name: firstName(item.display_name),
    name: item.display_name,
    date: formatCommunicationDate(event),
    time: formatCommunicationTime(event),
    clinic_name: clinicName,
    proposal_title: String(item.context?.proposal_title ?? ''),
    valid_until: formatCommunicationDate(item.context?.valid_until ?? null),
    package_title: String(item.context?.package_title ?? ''),
    remaining_credits: formatCredits(item.context?.remaining_credits),
    aftercare_instructions: String(item.context?.aftercare_instructions ?? ''),
  };
}

function formatCredits(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return value == null ? '' : String(value);
  return number.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

export function validateTemplatePlaceholders(body: string): string[] {
  const invalid = new Set<string>();
  for (const match of body.matchAll(PLACEHOLDER_RE)) {
    if (!PLACEHOLDER_SET.has(match[1])) invalid.add(match[1]);
  }
  return [...invalid];
}

export function renderCommunicationTemplate(body: string, values: Partial<Record<CommunicationPlaceholder, string>>): string {
  const invalid = validateTemplatePlaceholders(body);
  if (invalid.length) throw new Error(`Placeholder inválido: {${invalid[0]}}`);
  return body.replace(PLACEHOLDER_RE, (_full, key: CommunicationPlaceholder) => values[key] ?? '');
}

export function communicationRelativeLabel(item: CommunicationAttentionItem, now = new Date()): string {
  if (item.category === 'confirmation' && item.event_at) {
    const date = formatCommunicationDate(item.event_at);
    const time = formatCommunicationTime(item.event_at);
    return `${item.priority === 'today' ? 'Hoje' : item.priority === 'tomorrow' ? 'Amanhã' : date} · ${time}`;
  }
  if ((item.category === 'crm' || item.category === 'aftercare') && item.context?.due_on) {
    const due = new Date(`${item.context.due_on}T12:00:00-03:00`);
    const today = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now) + 'T12:00:00-03:00');
    const days = Math.round((today.getTime() - due.getTime()) / 86_400_000);
    if (days > 0) return `Atrasado há ${days} dia${days === 1 ? '' : 's'}`;
    return item.context.requires_professional_review ? 'Requer atenção da profissional' : 'Para hoje';
  }
  if (item.category === 'aftercare') return item.reason;
  if (item.category === 'proposal' && item.context?.sent_at) {
    const sent = new Date(item.context.sent_at);
    const days = Math.max(0, Math.floor((now.getTime() - sent.getTime()) / 86_400_000));
    return `Proposta enviada há ${days} dia${days === 1 ? '' : 's'}`;
  }
  if (item.category === 'package' && item.context?.valid_until) return `Válido até ${formatCommunicationDate(item.context.valid_until)}`;
  if (item.category === 'return' && item.context?.window_end) return `${item.reason} · até ${formatCommunicationDate(item.context.window_end)}`;
  return item.reason;
}

export function snoozeUntil(kind: 'later_today' | 'tomorrow' | '3d' | '7d', now = new Date()): Date {
  const local = new Date(now);
  if (kind === 'later_today') return new Date(now.getTime() + 4 * 60 * 60 * 1000);
  const days = kind === 'tomorrow' ? 1 : kind === '3d' ? 3 : 7;
  return new Date(local.getTime() + days * 86_400_000);
}

export async function copyCommunicationText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand('copy');
  textarea.remove();
  if (!ok) throw new Error('Não foi possível copiar a mensagem.');
}

export function communicationStatusLabel(context: string): string {
  return ({
    appointment_confirmation: 'Confirmação de horário',
    crm_followup: 'Follow-up CRM',
    procedure_return: 'Retorno',
    proposal_followup: 'Follow-up de proposta',
    package_expiry: 'Pacote / crédito',
    aftercare_instructions: 'Orientações pós-atendimento',
    post_procedure_checkin: 'Check-in pós-atendimento',
    relationship_reactivation: 'Relacionamento / reativação',
  } as Record<string, string>)[context] ?? 'Comunicação';
}
