import { describe, expect, it } from 'vitest';
import {
  SESSION_EXPIRED_MESSAGE,
  birthDateInputError,
  isPostgrestError,
  isValidCpf,
  normalizePatientCreateData,
  patientCreateFriendlyError,
  validatePatientCreateData,
  type PatientCreateData,
} from './patientInput';

const base: PatientCreateData = {
  name: 'Maria', birth_date: null, phone: null, email: null, cpf: null,
  profession: null, civil_status: null, weight: null, height: null, instagram: null,
  emergency_name: null, emergency_phone: null, convenio: null, notes: null,
  photo_url: null, start_date: null,
};

describe('patientInput', () => {
  it('normalizes fields before insert', () => {
    const data = normalizePatientCreateData({ ...base, name: '  Maria da Silva  ', email: '  MARIA@EXEMPLO.COM  ', cpf: '529.982.247-25', phone: '+55 (43) 99999-8888' });
    expect(data.name).toBe('Maria da Silva');
    expect(data.email).toBe('maria@exemplo.com');
    expect(data.cpf).toBe('52998224725');
    expect(data.phone).toBe('(43) 99999-8888');
  });

  it('validates required name, email and CPF', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(validatePatientCreateData({ ...base, name: ' ' })).toBe('Informe o nome da paciente.');
    expect(validatePatientCreateData({ ...base, email: 'invalido' })).toBe('Informe um email válido.');
    expect(validatePatientCreateData({ ...base, cpf: '12345678901' })).toBe('Informe um CPF válido.');
  });

  it('rejects future birth dates', () => {
    const now = new Date(2026, 7, 13, 12, 0, 0);
    expect(birthDateInputError('14/08/2026', now)).toBe('A data de nascimento não pode ser futura.');
    expect(birthDateInputError('13/08/2026', now)).toBeNull();
  });

  it('recognizes PostgREST-shaped objects without instanceof Error', () => {
    const error = { code: '23505', message: 'duplicate', details: null, hint: null };
    expect(error instanceof Error).toBe(false);
    expect(isPostgrestError(error)).toBe(true);
    expect(patientCreateFriendlyError(error)).toBe('Já existe uma paciente com esses dados.');
  });

  it('maps an authentication PostgREST response to the session-expired message', () => {
    const error = { code: 'PGRST301', message: 'authentication failed', details: null, hint: null };
    expect(patientCreateFriendlyError(error)).toBe(SESSION_EXPIRED_MESSAGE);
  });
});
