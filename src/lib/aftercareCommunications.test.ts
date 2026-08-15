import { describe, expect, it } from 'vitest';
import { DEFAULT_COMMUNICATION_TEMPLATES, communicationRelativeLabel, renderCommunicationTemplate, templateVariables, type CommunicationAttentionItem } from './communications';

const checkin: CommunicationAttentionItem = {
  item_key: 'aftercare_task:11111111-1111-1111-1111-111111111111',
  category: 'aftercare',
  source_type: 'procedure_followup_task',
  source_id: '11111111-1111-1111-1111-111111111111',
  patient_id: '22222222-2222-2222-2222-222222222222',
  contact_id: null,
  display_name: 'Maria Silva',
  phone: '(43) 99999-9999',
  due_at: '2026-08-15T12:00:00.000Z',
  event_at: '2026-08-15T12:00:00.000Z',
  reason: 'Check-in pós-atendimento',
  priority: 'today',
  template_key: 'post_procedure_checkin',
  context: { due_on: '2026-08-15', task_type: 'checkin', requires_professional_review: false },
  target_route: '/pacientes/22222222-2222-2222-2222-222222222222',
  last_contacted_at: null,
  snoozed_until: null,
};

const instructions: CommunicationAttentionItem = {
  ...checkin,
  item_key: 'aftercare:33333333-3333-3333-3333-333333333333:instructions',
  source_type: 'procedure_followup_plan',
  source_id: '33333333-3333-3333-3333-333333333333',
  template_key: 'aftercare_instructions',
  reason: 'Orientações pós-atendimento pendentes',
  context: { aftercare_instructions: 'Texto configurado pela profissional.' },
};

describe('aftercare communications', () => {
  it('renders the immutable instruction snapshot and no sensitive identifiers', () => {
    const text = renderCommunicationTemplate(DEFAULT_COMMUNICATION_TEMPLATES.aftercare_instructions, templateVariables(instructions, 'Clínica'));
    expect(text).toContain('Texto configurado pela profissional.');
    expect(text).not.toMatch(/cpf|diagnóstic/i);
  });

  it('keeps the check-in copy generic and non-diagnostic', () => {
    const text = renderCommunicationTemplate(DEFAULT_COMMUNICATION_TEMPLATES.post_procedure_checkin, templateVariables(checkin, 'Clínica'));
    expect(text).toContain('como você está');
    expect(text).not.toMatch(/normal|não se preocupe|diagnóstic|complica/i);
  });

  it('uses due_on calendar semantics for attention labels', () => {
    expect(communicationRelativeLabel(checkin, new Date('2026-08-15T10:00:00-03:00'))).toBe('Para hoje');
    expect(communicationRelativeLabel(checkin, new Date('2026-08-16T10:00:00-03:00'))).toBe('Atrasado há 1 dia');
  });
});
