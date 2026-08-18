import type { PostgrestError } from '@supabase/supabase-js';
import type { Patient } from '../types';
import { normalizeAcquisitionDraft } from './acquisition';

export type PatientCreateData = Omit<Patient, 'id' | 'user_id' | 'created_at'>;

export const SESSION_EXPIRED_MESSAGE = 'Sua sessão expirou. Entre novamente.';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizePhone(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  let digits = trimmed.replace(/\D/g, '');
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    digits = digits.slice(2);
  }

  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  return trimmed;
}

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

export function isValidCpf(value: string): boolean {
  const cpf = value.replace(/\D/g, '');
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;

  const calculateDigit = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(cpf[index]) * (length + 1 - index);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  return calculateDigit(9) === Number(cpf[9]) && calculateDigit(10) === Number(cpf[10]);
}

export function birthDateInputError(value: string, now = new Date()): string | null {
  if (!value) return null;

  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return 'Data de nascimento inválida. Use dd/mm/aaaa.';

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day);
  const validCalendarDate =
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day &&
    year >= 1900;

  if (!validCalendarDate) return 'Data de nascimento inválida. Use dd/mm/aaaa.';

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (date > today) return 'A data de nascimento não pode ser futura.';

  return null;
}

export function normalizePatientCreateData(data: PatientCreateData): PatientCreateData {
  const email = data.email?.trim().toLowerCase() || null;
  const cpf = data.cpf?.replace(/\D/g, '') || null;
  const acquisition = normalizeAcquisitionDraft({
    source: data.acquisition_source,
    sourceDetail: data.acquisition_source_detail,
    referredByPatientId: data.referred_by_patient_id,
    referrerName: data.referrer_name,
  });

  return {
    ...data,
    name: data.name.trim(),
    email,
    cpf,
    phone: normalizePhone(data.phone),
    emergency_phone: normalizePhone(data.emergency_phone),
    acquisition_source: acquisition.source,
    acquisition_source_detail: acquisition.sourceDetail,
    referred_by_patient_id: acquisition.referredByPatientId,
    referrer_name: acquisition.referrerName,
  };
}

export function validatePatientCreateData(data: PatientCreateData): string | null {
  if (!data.name.trim()) return 'Informe o nome da paciente.';
  if (data.email && !isValidEmail(data.email)) return 'Informe um email válido.';
  if (data.cpf && !isValidCpf(data.cpf)) return 'Informe um CPF válido.';
  return null;
}

export function isPostgrestError(error: unknown): error is PostgrestError {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as Partial<PostgrestError>;
  return typeof candidate.code === 'string' && typeof candidate.message === 'string';
}

export function patientCreateFriendlyError(error: unknown): string {
  if (error instanceof Error && error.message === SESSION_EXPIRED_MESSAGE) {
    return SESSION_EXPIRED_MESSAGE;
  }

  if (isPostgrestError(error)) {
    if (error.code === 'PGRST301' || error.code === 'PGRST302' || error.code === 'PGRST303') {
      return SESSION_EXPIRED_MESSAGE;
    }
    if (error.code === '23505') return 'Já existe uma paciente com esses dados.';
    if (error.code === '23502' || error.code === '23514' || error.code === '22P02') {
      return 'Alguns dados do cadastro são inválidos. Revise os campos e tente novamente.';
    }
    if (error.code === '42501') {
      return 'Não foi possível autorizar o cadastro. Atualize a página e tente novamente.';
    }
    if (error.code === '42703' || error.code === '42P01' || error.code === 'PGRST204' || error.code === 'PGRST205') {
      return 'O cadastro está temporariamente indisponível. Atualize a página e tente novamente.';
    }
  }

  if (error instanceof Error) {
    if (/failed to fetch|network|fetch failed/i.test(error.message)) {
      return 'Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.';
    }
    if (error.message) return error.message;
  }

  return 'Não foi possível cadastrar a paciente. Tente novamente.';
}
