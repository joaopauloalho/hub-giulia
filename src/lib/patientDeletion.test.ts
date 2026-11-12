import { describe, expect, it } from 'vitest';
import { PATIENT_HAS_HISTORY_MESSAGE, PATIENT_HAS_SIGNED_ANAMNESIS_MESSAGE, patientDeletionFriendlyError } from './patientDeletion';
import { SESSION_EXPIRED_MESSAGE } from './patientInput';

describe('patientDeletionFriendlyError', () => {
  it('blocks deletion of patients with linked records', () => {
    expect(patientDeletionFriendlyError({ code: 'P0001', message: 'PATIENT_HAS_RELATED_RECORDS' })).toBe(PATIENT_HAS_HISTORY_MESSAGE);
    expect(patientDeletionFriendlyError({ code: '23503', message: 'foreign key violation' })).toBe(PATIENT_HAS_HISTORY_MESSAGE);
    expect(patientDeletionFriendlyError({ code: 'P0001', message: 'PATIENT_HAS_SIGNED_ANAMNESIS' })).toBe(PATIENT_HAS_SIGNED_ANAMNESIS_MESSAGE);
  });
  it('handles missing patients and invalid sessions', () => {
    expect(patientDeletionFriendlyError({ code: 'P0002', message: 'PATIENT_NOT_FOUND' })).toContain('não foi encontrada');
    expect(patientDeletionFriendlyError({ code: '42501', message: 'AUTH_REQUIRED' })).toBe(SESSION_EXPIRED_MESSAGE);
  });
  it('does not leak internal errors', () => {
    expect(patientDeletionFriendlyError({ code: 'P0001', message: 'some internal message' })).not.toContain('internal');
    expect(patientDeletionFriendlyError(new Error('Failed to fetch'))).toContain('internet');
  });
});
