export interface PatientTimelineEvent {
  eventKey: string;
  eventType: 'appointment' | 'procedure' | 'return' | 'note' | 'contract' | 'photo' | 'anamnesis' | 'injectable' | string;
  occurredAt: string;
  title: string;
  subtitle: string | null;
  sourceId: string;
  metadata: Record<string, unknown>;
}

export function mergeTimelineEvents(current: PatientTimelineEvent[], incoming: PatientTimelineEvent[]) {
  const seen = new Set(current.map(event => event.eventKey));
  return [...current, ...incoming.filter(event => !seen.has(event.eventKey))];
}

export function getTimelineCursor(events: PatientTimelineEvent[]) {
  const last = events.length > 0 ? events[events.length - 1] : undefined;
  return last ? { at: last.occurredAt, key: last.eventKey } : null;
}

export function formatPatientMoney(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function patientTimelineIcon(type: string) {
  const icons: Record<string, string> = {
    appointment: 'calendar',
    procedure: 'procedure',
    return: 'return',
    note: 'note',
    contract: 'contract',
    photo: 'photo',
    anamnesis: 'anamnesis',
    injectable: 'injectable',
  };
  return icons[type] ?? 'event';
}
