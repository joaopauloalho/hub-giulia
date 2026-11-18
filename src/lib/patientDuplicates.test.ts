import { describe, expect, it } from 'vitest';
import {
  duplicateMatchDetail,
  duplicateMatchReasons,
  duplicateSearchKeys,
  duplicateWarningSignature,
  findPatientDuplicates,
  formatDuplicateAttendance,
  normalizeDuplicateCpf,
  normalizeDuplicateEmail,
  normalizeDuplicateName,
  normalizeDuplicatePhone,
  sortDuplicateMatches,
  type DuplicatePatientRecord,
} from './patientDuplicates';

const marina: DuplicatePatientRecord = {
  id: 'marina-aug',
  name: 'Marina Sampaio Alves',
  phone: '(43) 98888-7766',
  email: 'marina@exemplo.com',
  cpf: '529.982.247-25',
  archived_at: null,
};

const homonym: DuplicatePatientRecord = {
  id: 'marina-nov',
  name: '  MARÍNA   sampaio   alves ',
  phone: null,
  email: null,
  cpf: null,
  archived_at: null,
};

describe('patient duplicate normalization', () => {
  it('trata o mesmo nome com acento, maiúsculas e espaços repetidos', () => {
    expect(normalizeDuplicateName('  Marína   Sampaio   Alves ')).toBe('marina sampaio alves');
    expect(normalizeDuplicateName("D’Avila")).toBe("d'avila");
    expect(normalizeDuplicateName('Maria  Clara')).toBe('maria clara');
  });

  it('compara telefone só pelos dígitos nacionais e aceita +55', () => {
    expect(normalizeDuplicatePhone('+55 (43) 98888-7766')).toBe('43988887766');
    expect(normalizeDuplicatePhone('55 43 988887766')).toBe('43988887766');
    expect(normalizeDuplicatePhone('(43) 3333-4444')).toBe('4333334444');
    expect(normalizeDuplicatePhone('98888-7766')).toBeNull();
    expect(normalizeDuplicatePhone('+55')).toBeNull();
    expect(normalizeDuplicatePhone('')).toBeNull();
  });

  it('compara CPF e e-mail só quando o valor está completo', () => {
    expect(normalizeDuplicateCpf('529.982.247-25')).toBe('52998224725');
    expect(normalizeDuplicateCpf('529.982.247')).toBeNull();
    expect(normalizeDuplicateEmail('  Maria@Exemplo.com ')).toBe('maria@exemplo.com');
    expect(normalizeDuplicateEmail('maria@exemplo')).toBeNull();
    expect(normalizeDuplicateEmail('')).toBeNull();
  });

  it('não pesquisa nome curto nem campos vazios', () => {
    expect(duplicateSearchKeys({ name: 'Li', phone: '43', cpf: '123', email: 'sem-arroba' })).toEqual({
      name: null,
      phone: null,
      cpf: null,
      email: null,
    });
  });
});

describe('patient duplicate matching', () => {
  const patients = [marina, homonym, {
    id: 'outra',
    name: 'Marina Sampaio',
    phone: '43911112222',
    email: 'outra@exemplo.com',
    cpf: '111.444.777-35',
    archived_at: null,
  }];

  it('encontra o mesmo nome completo e não um trecho do nome', () => {
    const matches = findPatientDuplicates(patients, { name: 'marina   SAMPAIO alves' });
    expect(matches.map(match => match.id).sort()).toEqual(['marina-aug', 'marina-nov']);
    expect(findPatientDuplicates(patients, { name: 'Marina Sampaio' }).map(match => match.id)).toEqual(['outra']);
    expect(findPatientDuplicates(patients, { name: 'Ana Paula' })).toEqual([]);
  });

  it('encontra telefone, CPF e e-mail com formatação diferente', () => {
    expect(duplicateMatchReasons(marina, duplicateSearchKeys({
      phone: '+55 43 98888-7766',
      cpf: '52998224725',
      email: 'MARINA@EXEMPLO.COM',
    }))).toEqual(['phone', 'cpf', 'email']);
  });

  it('não casa telefone, CPF ou e-mail vazio com cadastro sem esses dados', () => {
    expect(duplicateMatchReasons(homonym, duplicateSearchKeys({ name: 'x', phone: '', cpf: '', email: '' }))).toEqual([]);
    expect(findPatientDuplicates(patients, { phone: '(43) 9888-7766' })).toEqual([]);
    expect(findPatientDuplicates([marina, { ...homonym, phone: '' }], { phone: null })).toEqual([]);
  });

  it('junta os motivos do mesmo cadastro e ignora quem não coincide', () => {
    const [match] = findPatientDuplicates(patients, {
      name: 'Marína Sampaio Alves',
      phone: '43988887766',
    });
    expect(match?.id).toBe('marina-aug');
    expect(match?.reasons).toEqual(['name', 'phone']);
  });

  it('mostra ativas com mais coincidências primeiro e descreve o cadastro', () => {
    const sorted = sortDuplicateMatches([
      { ...homonym, archived_at: '2026-11-01T00:00:00.000Z', reasons: ['name'] as const },
      { ...marina, reasons: ['name', 'phone'] as const },
      { id: 'bruno', name: 'Bruno', phone: '43988887766', email: null, cpf: null, archived_at: null, reasons: ['phone'] as const },
    ]);
    expect(sorted.map(match => match.id)).toEqual(['marina-aug', 'bruno', 'marina-nov']);
    expect(duplicateMatchDetail({
      ...marina,
      reasons: ['name', 'phone'],
      last_attendance_at: '2026-08-25T15:00:00.000Z',
    })).toBe('mesmo nome · mesmo telefone · (43) 98888-7766 · último atendimento 25/08/2026');
    expect(duplicateMatchDetail({
      phone: null,
      archived_at: '2026-11-13T00:00:00.000Z',
      reasons: ['name'],
    })).toBe('mesmo nome · arquivada · sem telefone');
  });

  it('formata o último atendimento no fuso da clínica', () => {
    expect(formatDuplicateAttendance('2026-08-25T02:30:00.000Z')).toBe('24/08/2026');
    expect(formatDuplicateAttendance(null)).toBeNull();
    expect(formatDuplicateAttendance('data-invalida')).toBeNull();
  });

  it('monta uma assinatura estável para o aviso já exibido', () => {
    const input = { name: 'Marína Sampaio Alves', phone: '+55 (43) 98888-7766' };
    expect(duplicateWarningSignature(input, [{ id: 'b' }, { id: 'a' }]))
      .toBe(duplicateWarningSignature(input, [{ id: 'a' }, { id: 'b' }]));
    expect(duplicateWarningSignature(input, [])).toBeNull();
    expect(duplicateWarningSignature({ name: 'Ana' }, [{ id: 'a' }]))
      .not.toBe(duplicateWarningSignature({ name: 'Ana Paula' }, [{ id: 'a' }]));
  });
});
