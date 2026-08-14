import { describe, expect, it } from 'vitest';
import { POSTGREST_SELECT } from './postgrestRelationshipHints';

const expectedOwnerHints = [
  'appointments_patient_owner_fkey',
  'appointments_service_owner_fkey',
  'procedures_patient_owner_fkey',
  'procedure_payments_procedure_owner_fkey',
  'procedure_items_procedure_owner_fkey',
  'pix_installments_procedure_owner_fkey',
  'patient_notes_patient_owner_fkey',
  'patient_photos_procedure_owner_fkey',
  'contracts_template_owner_fkey',
] as const;

describe('PostgREST relationship hints', () => {
  it.each(expectedOwnerHints)('pins relationship %s explicitly', constraint => {
    const selects = Object.values(POSTGREST_SELECT).join('\n');
    expect(selects).toContain(`!${constraint}`);
  });

  it('keeps patient procedure relation ownership-safe inside nested finance embeds', () => {
    expect(POSTGREST_SELECT.financePixPending).toContain('patient:patients!procedures_patient_owner_fkey');
    expect(POSTGREST_SELECT.financeScheduledPayments).toContain('patient:patients!procedures_patient_owner_fkey');
  });
});
