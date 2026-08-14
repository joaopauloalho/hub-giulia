import { describe, expect, it } from 'vitest';
import { formatPatientMoney, getTimelineCursor, mergeTimelineEvents, type PatientTimelineEvent } from './patient360';

const event = (eventKey: string, occurredAt: string): PatientTimelineEvent => ({
  eventKey,
  eventType: 'procedure',
  occurredAt,
  title: eventKey,
  subtitle: null,
  sourceId: eventKey,
  metadata: {},
});

describe('Paciente 360 timeline helpers', () => {
  it('mantém paginação estável sem duplicar eventos', () => {
    const first = [event('a', '2026-08-14T12:00:00Z'), event('b', '2026-08-13T12:00:00Z')];
    const next = [event('b', '2026-08-13T12:00:00Z'), event('c', '2026-08-12T12:00:00Z')];
    expect(mergeTimelineEvents(first, next).map(item => item.eventKey)).toEqual(['a', 'b', 'c']);
  });

  it('usa data e chave do último evento como cursor', () => {
    expect(getTimelineCursor([
      event('a', '2026-08-14T12:00:00Z'),
      event('b', '2026-08-13T12:00:00Z'),
    ])).toEqual({ at: '2026-08-13T12:00:00Z', key: 'b' });
  });

  it('formata valores financeiros sem alterar a grandeza', () => {
    expect(formatPatientMoney(1234.5)).toContain('1.234,50');
    expect(formatPatientMoney(null)).toContain('0,00');
  });
});
