export interface ServiceAftercareStep {
  id?: string;
  offset_days: number;
  label: string | null;
  sort_order?: number;
}

export interface ServiceAftercareProtocol {
  id: string | null;
  service_id: string;
  name: string;
  enabled: boolean;
  version: number;
  instructions: string;
  photo_followup: boolean;
  updated_at: string | null;
  steps: ServiceAftercareStep[];
}

export function emptyServiceAftercareProtocol(serviceId: string): ServiceAftercareProtocol {
  return { id: null, service_id: serviceId, name: 'Pós-atendimento', enabled: false, version: 0, instructions: '', photo_followup: false, updated_at: null, steps: [] };
}

export function normalizeServiceAftercareProtocol(serviceId: string, value: unknown): ServiceAftercareProtocol {
  if (!value || typeof value !== 'object') return emptyServiceAftercareProtocol(serviceId);
  const data = value as Record<string, unknown>;
  const steps = Array.isArray(data.steps) ? data.steps.map((step, index) => {
    const row = (step ?? {}) as Record<string, unknown>;
    return {
      id: typeof row.id === 'string' ? row.id : undefined,
      offset_days: Number(row.offset_days ?? 0),
      label: typeof row.label === 'string' && row.label.trim() ? row.label : null,
      sort_order: Number(row.sort_order ?? index),
    };
  }) : [];
  return {
    id: typeof data.id === 'string' ? data.id : null,
    service_id: serviceId,
    name: typeof data.name === 'string' && data.name.trim() ? data.name : 'Pós-atendimento',
    enabled: Boolean(data.enabled),
    version: Number(data.version ?? 0),
    instructions: typeof data.instructions === 'string' ? data.instructions : '',
    photo_followup: Boolean(data.photo_followup),
    updated_at: typeof data.updated_at === 'string' ? data.updated_at : null,
    steps,
  };
}

export function validateAftercareSteps(steps: ServiceAftercareStep[]): string | null {
  if (steps.length > 20) return 'Use no máximo 20 check-ins por protocolo.';
  const seen = new Set<number>();
  for (const step of steps) {
    if (!Number.isInteger(step.offset_days) || step.offset_days < 0 || step.offset_days > 3650) return 'Informe dias inteiros entre 0 e 3650.';
    if (seen.has(step.offset_days)) return 'Não repita dois check-ins para o mesmo número de dias.';
    seen.add(step.offset_days);
    if ((step.label?.trim().length ?? 0) > 120) return 'O nome do check-in deve ter no máximo 120 caracteres.';
  }
  return null;
}

export function aftercareDate(value?: string | null): string {
  if (!value) return '—';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00-03:00`) : new Date(value);
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

export type AftercareOrientationStatus = 'not_configured' | 'pending' | 'sent_whatsapp' | 'delivered_manual';

export function orientationStatusLabel(status: AftercareOrientationStatus): string {
  return ({ not_configured: 'Sem orientação configurada', pending: 'Pendente de entrega', sent_whatsapp: 'Enviada manualmente pelo WhatsApp', delivered_manual: 'Entregue manualmente' } as const)[status];
}
