import { describe, expect, it } from 'vitest';
import { normalizePatientSearch, patientMatchesSearch } from './patientSearch';

describe('patient search', () => {
  const patient = { name: 'Letícia Fárias', phone: '(43) 99999-8888', email: 'leticia@exemplo.com' };

  it('encontra o mesmo nome com e sem acentos, independente das maiúsculas', () => {
    expect(patientMatchesSearch(patient, 'leticia')).toBe(true);
    expect(patientMatchesSearch(patient, 'LETÍCIA')).toBe(true);
    expect(patientMatchesSearch(patient, 'farias')).toBe(true);
    expect(patientMatchesSearch(patient, 'LETICIA FARIAS')).toBe(true);
  });

  it('busca por parte do nome ou pelo nome composto com espaços extras', () => {
    expect(patientMatchesSearch({ name: 'Maria  Fernanda Oliveira' }, '  fernanda  ')).toBe(true);
    expect(patientMatchesSearch({ name: 'Maria  Fernanda Oliveira' }, 'maria fernanda')).toBe(true);
  });

  it('mantém pesquisa por telefone e email', () => {
    expect(patientMatchesSearch(patient, '99999')).toBe(true);
    expect(patientMatchesSearch(patient, 'LETICIA@EXEMPLO')).toBe(true);
  });

  it('não encontra nomes diferentes e lida com campo vazio', () => {
    expect(patientMatchesSearch(patient, 'Marcia')).toBe(false);
    expect(patientMatchesSearch(patient, '   ')).toBe(true);
    expect(normalizePatientSearch('  João   D’Ávila ')).toBe('joao d’avila');
  });
});
