import type { Patient } from '../types';

function csvCell(value: string | null | undefined): string {
  const normalized = value ?? '';
  return `"${normalized.replace(/"/g, '""')}"`;
}

function formatDate(value: string | null): string {
  if (!value) return '';
  try {
    return new Date(value).toLocaleDateString('pt-BR');
  } catch {
    return value;
  }
}

export function exportPatientsCSV(patients: Patient[]) {
  const header = ['nome', 'telefone', 'email', 'profissao', 'data_nascimento', 'data_cadastro', 'instagram'];
  const rows = patients.map(patient => [
    patient.name,
    patient.phone,
    patient.email,
    patient.profession,
    formatDate(patient.birth_date),
    formatDate(patient.created_at),
    patient.instagram,
  ].map(csvCell).join(','));

  const csv = [header.join(','), ...rows].join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pacientes-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
