import { describe, expect, it } from 'vitest';
import {
  filterPatientJourneyRows,
  journeyAgeLabel,
  journeyAttentionLabel,
  journeyMoney,
  type PatientJourneyRow,
} from './patientJourney';

const row = (overrides: Partial<PatientJourneyRow> = {}): PatientJourneyRow => ({
  patient_id: crypto.randomUUID(),
  patient_name: 'Paciente Teste',
  phone: null,
  profession: null,
  photo_url: null,
  moment: 'unclassified',
  moment_source: 'automatic',
  moment_reason: 'Sem sinal',
  moment_since: null,
  days_in_moment: 0,
  attention_level: 'warning',
  next_action: 'Classificar paciente',
  deal_id: null,
  deal_stage: null,
  deal_title: null,
  proposal_version_id: null,
  proposal_title: null,
  proposal_total_value: null,
  proposal_status: null,
  proposal_valid_until: null,
  proposal_sent_at: null,
  available_balance: 0,
  active_package_title: null,
  next_appointment_at: null,
  last_procedure_at: null,
  open_returns_count: 0,
  followup_due_on: null,
  classification_debug: null,
  ...overrides,
});

describe('patientJourney', () => {
  it('filtra por momento sem perder pacientes de atenção', () => {
    const rows = [
      row({ moment: 'quote_sent', attention_level: 'urgent' }),
      row({ moment: 'in_treatment', attention_level: 'none' }),
    ];
    expect(filterPatientJourneyRows(rows, 'quote_sent', false)).toHaveLength(1);
    expect(filterPatientJourneyRows(rows, 'all', true)).toHaveLength(1);
  });

  it('formata tempo no momento de forma natural', () => {
    expect(journeyAgeLabel(0)).toBe('hoje');
    expect(journeyAgeLabel(1)).toBe('há 1 dia');
    expect(journeyAgeLabel(5)).toBe('há 5 dias');
  });

  it('não cria alerta quando a atenção é normal', () => {
    expect(journeyAttentionLabel('none')).toBeNull();
    expect(journeyAttentionLabel('warning')).toBe('Precisa de atenção');
    expect(journeyAttentionLabel('urgent')).toBe('Prioridade alta');
  });

  it('formata valores comerciais em BRL', () => {
    expect(journeyMoney(1250)).toContain('1.250');
    expect(journeyMoney(null)).toBeNull();
  });
});
