import { describe, expect, it } from 'vitest';
import { DEFAULT_COMMUNICATION_TEMPLATES, communicationRelativeLabel, renderCommunicationTemplate, snoozeUntil, templateVariables, validateTemplatePlaceholders, type CommunicationAttentionItem } from './communications';

const appointment: CommunicationAttentionItem = {
  item_key: 'appointment:11111111-1111-1111-1111-111111111111:confirmation', category: 'confirmation', source_type: 'appointment', source_id: '11111111-1111-1111-1111-111111111111', patient_id: '22222222-2222-2222-2222-222222222222', contact_id: null, display_name: 'Maria Silva', phone: '(43) 99999-9999', due_at: '2026-08-15T17:00:00.000Z', event_at: '2026-08-15T17:00:00.000Z', reason: 'Horário aguardando confirmação', priority: 'tomorrow', template_key: 'appointment_confirmation', context: { scheduled_at: '2026-08-15T17:00:00.000Z' }, target_route: '/agenda', last_contacted_at: null, snoozed_until: null,
};

describe('communication templates', () => {
  it('renders whitelisted placeholders in Sao Paulo time', () => {
    const text = renderCommunicationTemplate(DEFAULT_COMMUNICATION_TEMPLATES.appointment_confirmation, templateVariables(appointment, 'Clínica'));
    expect(text).toContain('Oi, Maria!');
    expect(text).toContain('15/08');
    expect(text).toContain('14:00');
    expect(text).not.toMatch(/\{\w+\}/);
  });
  it('rejects unknown placeholders explicitly', () => {
    expect(validateTemplatePlaceholders('Oi {first_name}, CPF {cpf}')).toEqual(['cpf']);
    expect(() => renderCommunicationTemplate('Oi {cpf}', {})).toThrow(/Placeholder inválido/);
  });
  it('keeps default appointment copy private', () => {
    const lower = DEFAULT_COMMUNICATION_TEMPLATES.appointment_confirmation.toLowerCase();
    expect(lower).not.toContain('serviço');
    expect(lower).not.toContain('procedimento');
    expect(lower).not.toContain('diagnóstico');
    expect(lower).not.toContain('cpf');
  });
  it('renders package balance and validity', () => {
    expect(renderCommunicationTemplate(DEFAULT_COMMUNICATION_TEMPLATES.package_expiry, { first_name: 'Ana', remaining_credits: '2', valid_until: '30/08' })).toContain('2 crédito(s)');
  });
});

describe('communication helpers', () => {
  it('labels tomorrow appointment using clinic timezone', () => {
    expect(communicationRelativeLabel(appointment, new Date('2026-08-14T21:00:00-03:00'))).toBe('Amanhã · 14:00');
  });
  it('creates deterministic relative snoozes', () => {
    const now = new Date('2026-08-14T12:00:00.000Z');
    expect(snoozeUntil('later_today', now).toISOString()).toBe('2026-08-14T16:00:00.000Z');
    expect(snoozeUntil('3d', now).toISOString()).toBe('2026-08-17T12:00:00.000Z');
  });
});
