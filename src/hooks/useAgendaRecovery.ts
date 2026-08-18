import { supabase } from '../lib/supabase';
import { POSTGREST_SELECT } from '../lib/postgrestRelationshipHints';
import type { AgendaAppointment } from './useAgenda';

export type WaitlistPeriod = 'morning' | 'afternoon' | 'evening';
export type WaitlistStatus = 'active' | 'fulfilled' | 'dismissed' | 'expired';

export type WaitlistEntry = {
  id: string;
  patient_id: string;
  service_id: string | null;
  service_name: string | null;
  source_appointment_id: string | null;
  source_scheduled_at: string | null;
  preferred_period: WaitlistPeriod | null;
  preferred_weekdays: number[] | null;
  expires_on: string | null;
  notes: string | null;
  status: WaitlistStatus;
  created_at: string;
  updated_at: string;
};

export type WaitlistCandidate = {
  entry_id: string;
  patient_id: string;
  patient_name: string;
  phone: string | null;
  service_id: string | null;
  service_name: string | null;
  preferred_period: WaitlistPeriod | null;
  preferred_weekdays: number[] | null;
  expires_on: string | null;
  notes: string | null;
  created_at: string;
  source_appointment_id: string | null;
  source_scheduled_at: string | null;
  source_duration_minutes: number | null;
  source_service_id: string | null;
  source_service_name: string | null;
};

export type WaitlistSaveInput = {
  patientId: string;
  serviceId?: string | null;
  sourceAppointmentId?: string | null;
  preferredPeriod?: WaitlistPeriod | null;
  preferredWeekdays?: number[] | null;
  expiresOn?: string | null;
  notes?: string | null;
};

function fail(error: { message?: string } | null, fallback: string): never {
  throw new Error(error?.message || fallback);
}

export async function getPatientWaitlist(patientId: string): Promise<WaitlistEntry | null> {
  const { data, error } = await supabase.rpc('get_appointment_waitlist_entry_v1', { p_patient_id: patientId });
  if (error) fail(error, 'Não foi possível carregar a lista de encaixe.');
  const row = Array.isArray(data) ? data[0] : data;
  return (row as WaitlistEntry | undefined) ?? null;
}

export async function savePatientWaitlist(input: WaitlistSaveInput): Promise<string> {
  const { data, error } = await supabase.rpc('upsert_appointment_waitlist_entry_v1', {
    p_patient_id: input.patientId,
    p_service_id: input.serviceId || null,
    p_source_appointment_id: input.sourceAppointmentId || null,
    p_preferred_period: input.preferredPeriod || null,
    p_preferred_weekdays: input.preferredWeekdays?.length ? input.preferredWeekdays : null,
    p_expires_on: input.expiresOn || null,
    p_notes: input.notes?.trim() || null,
  });
  if (error) fail(error, 'Não foi possível salvar a lista de encaixe.');
  return String(data);
}

export async function dismissPatientWaitlist(entryId: string): Promise<void> {
  const { error } = await supabase.rpc('dismiss_appointment_waitlist_entry_v1', { p_entry_id: entryId });
  if (error) fail(error, 'Não foi possível retirar da lista de encaixe.');
}

export async function fulfillPatientWaitlist(entryId: string, appointmentId: string): Promise<void> {
  const { error } = await supabase.rpc('fulfill_appointment_waitlist_entry_v1', { p_entry_id: entryId, p_appointment_id: appointmentId });
  if (error) fail(error, 'Não foi possível concluir a lista de encaixe.');
}

export async function listWaitlistCandidates(slot: Pick<AgendaAppointment, 'scheduled_at' | 'duration_minutes' | 'service_id'>): Promise<WaitlistCandidate[]> {
  const { data, error } = await supabase.rpc('list_appointment_waitlist_candidates_v1', {
    p_scheduled_at: slot.scheduled_at,
    p_duration_minutes: slot.duration_minutes ?? 60,
    p_service_id: slot.service_id ?? null,
  });
  if (error) fail(error, 'Não foi possível buscar possíveis encaixes.');
  return (data ?? []) as WaitlistCandidate[];
}

export async function getAgendaAppointmentForRecovery(id: string): Promise<AgendaAppointment> {
  const { data, error } = await supabase.from('appointments').select(POSTGREST_SELECT.agenda).eq('id', id).single();
  if (error || !data) fail(error, 'O agendamento que seria antecipado não está mais disponível.');
  return data as unknown as AgendaAppointment;
}

export async function loadRecoveryCommunicationSettings(): Promise<{ templateBody: string | null; clinicName: string }> {
  const [{ data: template }, { data: profile }] = await Promise.all([
    supabase.from('communication_templates').select('template_key,body,enabled').eq('template_key', 'waitlist_slot').maybeSingle(),
    supabase.from('professional_profiles').select('display_name').maybeSingle(),
  ]);
  return {
    templateBody: template?.enabled ? String(template.body ?? '') : null,
    clinicName: String(profile?.display_name ?? ''),
  };
}

export async function recordWaitlistManualContact(input: { entryId: string; slotAt: string; recipient: string; body: string; idempotencyKey: string }): Promise<void> {
  const { error } = await supabase.rpc('record_waitlist_manual_contact_v1', {
    p_entry_id: input.entryId,
    p_slot_at: input.slotAt,
    p_recipient_phone: input.recipient,
    p_message_body: input.body,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) fail(error, 'Não foi possível registrar o contato.');
}
