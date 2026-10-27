/**
 * Normalizes patient searches without changing the stored/displayed name.
 * Keeping client filtering aligned with the accent-insensitive database search
 * avoids hiding results returned by the server.
 */
export function normalizePatientSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function patientMatchesSearch(
  patient: { name: string; phone?: string | null; email?: string | null },
  search: string,
): boolean {
  const term = normalizePatientSearch(search);
  return !term || [patient.name, patient.phone, patient.email]
    .some(value => normalizePatientSearch(value ?? '').includes(term));
}
