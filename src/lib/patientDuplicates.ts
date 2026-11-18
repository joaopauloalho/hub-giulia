import { isValidEmail } from './patientInput';

export type DuplicateReason = 'name' | 'phone' | 'cpf' | 'email';

export interface DuplicatePatientRecord {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  cpf: string | null;
  archived_at?: string | null;
}

export interface DuplicateSearchInput {
  name?: string | null;
  phone?: string | null;
  cpf?: string | null;
  email?: string | null;
}

export interface DuplicateSearchKeys {
  name: string | null;
  phone: string | null;
  cpf: string | null;
  email: string | null;
}

export type DuplicateMatch<T extends DuplicatePatientRecord = DuplicatePatientRecord> = T & {
  reasons: readonly DuplicateReason[];
};

const NAME_MIN_LENGTH = 3;
const REASON_LABEL: Record<DuplicateReason, string> = {
  name: 'mesmo nome',
  phone: 'mesmo telefone',
  cpf: 'mesmo CPF',
  email: 'mesmo e-mail',
};

/**
 * Same person-name for duplicate warnings: ignore case, accents and repeated spaces.
 * This is an exact match of the full name, so "Marina" does not warn about "Marina Alves".
 */
export function normalizeDuplicateName(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘`´]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Digits only, dropping a leading Brazil country code. Incomplete numbers are not comparable. */
export function normalizeDuplicatePhone(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  if (!digits) return null;
  const national = (digits.length === 12 || digits.length === 13) && digits.startsWith('55')
    ? digits.slice(2)
    : digits;
  if (national.length === 10 || national.length === 11) return national;
  return null;
}

export function normalizeDuplicateCpf(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length === 11 ? digits : null;
}

export function normalizeDuplicateEmail(value: string | null | undefined): string | null {
  const email = (value ?? '').trim().toLowerCase();
  if (!email || !isValidEmail(email)) return null;
  return email;
}

export function duplicateSearchKeys(input: DuplicateSearchInput): DuplicateSearchKeys {
  const name = normalizeDuplicateName(input.name);
  return {
    name: name.length >= NAME_MIN_LENGTH ? name : null,
    phone: normalizeDuplicatePhone(input.phone),
    cpf: normalizeDuplicateCpf(input.cpf),
    email: normalizeDuplicateEmail(input.email),
  };
}

export function hasDuplicateSearch(keys: DuplicateSearchKeys): boolean {
  return Boolean(keys.name || keys.phone || keys.cpf || keys.email);
}

export function duplicateMatchReasons(patient: DuplicatePatientRecord, keys: DuplicateSearchKeys): DuplicateReason[] {
  const reasons: DuplicateReason[] = [];
  if (keys.name && normalizeDuplicateName(patient.name) === keys.name) reasons.push('name');
  const phone = normalizeDuplicatePhone(patient.phone);
  if (keys.phone && phone && phone === keys.phone) reasons.push('phone');
  const cpf = normalizeDuplicateCpf(patient.cpf);
  if (keys.cpf && cpf && cpf === keys.cpf) reasons.push('cpf');
  const email = normalizeDuplicateEmail(patient.email);
  if (keys.email && email && email === keys.email) reasons.push('email');
  return reasons;
}

export function findPatientDuplicates<T extends DuplicatePatientRecord>(
  patients: readonly T[],
  input: DuplicateSearchInput,
): DuplicateMatch<T>[] {
  const keys = duplicateSearchKeys(input);
  if (!hasDuplicateSearch(keys)) return [];
  return patients.flatMap(patient => {
    const reasons = duplicateMatchReasons(patient, keys);
    return reasons.length ? [{ ...patient, reasons }] : [];
  });
}

export function sortDuplicateMatches<T extends DuplicateMatch>(matches: readonly T[]): T[] {
  return [...matches].sort((left, right) => {
    const archived = Number(Boolean(left.archived_at)) - Number(Boolean(right.archived_at));
    if (archived) return archived;
    const reasonCount = right.reasons.length - left.reasons.length;
    if (reasonCount) return reasonCount;
    return left.name.localeCompare(right.name, 'pt-BR');
  });
}

export function duplicateWarningSignature(input: DuplicateSearchInput, matches: readonly { id: string }[]): string | null {
  const keys = duplicateSearchKeys(input);
  if (!hasDuplicateSearch(keys) || matches.length === 0) return null;
  return JSON.stringify({ keys, ids: matches.map(match => match.id).sort() });
}

export function formatDuplicateAttendance(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(date);
  const day = parts.find(part => part.type === 'day')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const year = parts.find(part => part.type === 'year')?.value;
  if (!day || !month || !year) return null;
  return `${day}/${month}/${year}`;
}

export function duplicateMatchDetail(match: {
  phone?: string | null;
  archived_at?: string | null;
  last_attendance_at?: string | null;
  reasons: readonly DuplicateReason[];
}): string {
  const parts = match.reasons.map(reason => REASON_LABEL[reason]);
  if (match.archived_at) parts.push('arquivada');
  parts.push(match.phone?.trim() || 'sem telefone');
  const attendance = formatDuplicateAttendance(match.last_attendance_at);
  if (attendance) parts.push(`último atendimento ${attendance}`);
  return parts.join(' · ');
}
