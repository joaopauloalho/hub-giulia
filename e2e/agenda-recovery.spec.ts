import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { browserLogin, signedInClient } from './helpers';

type E2EState = { users: { a: string; b: string }; serviceId: string; patientId: string };
const state = async () => JSON.parse(await fs.readFile('.e2e-state.json', 'utf8')) as E2EState;

async function createPatient(name: string, phone: string) {
  const a = await signedInClient('a');
  const { data, error } = await a.from('patients').insert({ name, phone }).select('id,name,phone').single();
  expect(error).toBeNull();
  return data!;
}

async function createAppointment(patientId: string, serviceId: string, scheduledAt: string, duration = 60) {
  const a = await signedInClient('a');
  const { data, error } = await a.from('appointments').insert({
    patient_id: patientId,
    service_id: serviceId,
    scheduled_at: scheduledAt,
    duration_minutes: duration,
  }).select('id,scheduled_at,status').single();
  expect(error).toBeNull();
  return data!;
}

test.describe.configure({ mode: 'serial' });

test('waitlist is owner-scoped, idempotent, deterministically matched and fulfilled only after a real appointment', async () => {
  const seeded = await state();
  const a = await signedInClient('a');
  const b = await signedInClient('b');
  const patient = await createPatient(`E2E Encaixe ${randomUUID().slice(0, 8)}`, '+55 43 99999-1010');
  const source = await createAppointment(patient.id, seeded.serviceId, '2030-01-20T15:00:00-03:00', 60);
  const args = {
    p_patient_id: patient.id,
    p_service_id: seeded.serviceId,
    p_source_appointment_id: source.id,
    p_preferred_period: 'afternoon',
    p_preferred_weekdays: [1],
    p_expires_on: '2030-01-19',
    p_notes: 'E2E aceita segunda à tarde',
  };

  const first = await a.rpc('upsert_appointment_waitlist_entry_v1', args);
  const second = await a.rpc('upsert_appointment_waitlist_entry_v1', { ...args, p_notes: 'E2E edição sem duplicar' });
  expect(first.error).toBeNull();
  expect(second.error).toBeNull();
  expect(second.data).toBe(first.data);
  const entryId = String(first.data);

  const active = await a.from('appointment_waitlist_entries').select('id,status').eq('patient_id', patient.id).eq('status', 'active');
  expect(active.error).toBeNull();
  expect(active.data).toHaveLength(1);

  const mondayAfternoon = await a.rpc('list_appointment_waitlist_candidates_v1', {
    p_scheduled_at: '2030-01-07T15:00:00-03:00', p_duration_minutes: 60, p_service_id: seeded.serviceId,
  });
  expect(mondayAfternoon.error).toBeNull();
  expect((mondayAfternoon.data ?? []).some((row: { entry_id: string }) => row.entry_id === entryId)).toBe(true);

  const mondayMorning = await a.rpc('list_appointment_waitlist_candidates_v1', {
    p_scheduled_at: '2030-01-07T09:00:00-03:00', p_duration_minutes: 60, p_service_id: seeded.serviceId,
  });
  expect((mondayMorning.data ?? []).some((row: { entry_id: string }) => row.entry_id === entryId)).toBe(false);

  const tuesdayAfternoon = await a.rpc('list_appointment_waitlist_candidates_v1', {
    p_scheduled_at: '2030-01-08T15:00:00-03:00', p_duration_minutes: 60, p_service_id: seeded.serviceId,
  });
  expect((tuesdayAfternoon.data ?? []).some((row: { entry_id: string }) => row.entry_id === entryId)).toBe(false);

  const crossTenantRead = await b.from('appointment_waitlist_entries').select('id').eq('id', entryId);
  expect(crossTenantRead.error).toBeNull();
  expect(crossTenantRead.data).toEqual([]);
  const crossTenantRpc = await b.rpc('get_appointment_waitlist_entry_v1', { p_patient_id: patient.id });
  expect(crossTenantRpc.error).toBeNull();
  expect(crossTenantRpc.data).toEqual([]);
  const crossTenantWrite = await b.rpc('upsert_appointment_waitlist_entry_v1', { ...args, p_notes: 'E2E SHOULD FAIL' });
  expect(crossTenantWrite.error).not.toBeNull();

  const contactKey = randomUUID();
  const contactArgs = {
    p_entry_id: entryId,
    p_slot_at: '2030-01-07T15:00:00-03:00',
    p_recipient_phone: '+55 43 99999-1010',
    p_message_body: 'E2E mensagem manual de encaixe',
    p_idempotency_key: contactKey,
  };
  const contact1 = await a.rpc('record_waitlist_manual_contact_v1', contactArgs);
  const contact2 = await a.rpc('record_waitlist_manual_contact_v1', contactArgs);
  expect(contact1.error).toBeNull();
  expect(contact2.error).toBeNull();
  const messages = await a.from('communication_messages').select('id,status').eq('idempotency_key', contactKey);
  expect(messages.error).toBeNull();
  expect(messages.data).toHaveLength(1);
  expect(messages.data?.[0]?.status).toBe('sent_manual');

  const rescheduled = await a.from('appointments').update({ scheduled_at: '2030-01-07T15:00:00-03:00' }).eq('id', source.id).select('id').single();
  expect(rescheduled.error).toBeNull();
  const fulfilled = await a.rpc('fulfill_appointment_waitlist_entry_v1', { p_entry_id: entryId, p_appointment_id: source.id });
  expect(fulfilled.error).toBeNull();
  expect(fulfilled.data).toBe(true);
  const finalEntry = await a.from('appointment_waitlist_entries').select('status,fulfilled_appointment_id').eq('id', entryId).single();
  expect(finalEntry.data).toMatchObject({ status: 'fulfilled', fulfilled_appointment_id: source.id });
});

test('cancel and no-show recovery appear only without a future valid appointment and support dismiss', async () => {
  const seeded = await state();
  const a = await signedInClient('a');
  const canceledPatient = await createPatient(`E2E Cancelou ${randomUUID().slice(0, 8)}`, '+55 43 99999-2020');
  const canceled = await createAppointment(canceledPatient.id, seeded.serviceId, '2030-02-04T15:00:00-03:00');
  const cancelResult = await a.from('appointments').update({ status: 'cancelado', cancellation_reason: 'E2E viagem' }).eq('id', canceled.id).select('id').single();
  expect(cancelResult.error).toBeNull();

  const recovery = await a.rpc('list_relationship_opportunities_v2', { p_category: 'reschedule', p_search: canceledPatient.name, p_include_snoozed: false, p_limit: 50, p_offset: 0 });
  expect(recovery.error).toBeNull();
  expect(recovery.data).toHaveLength(1);
  expect(recovery.data?.[0]?.opportunities?.[0]?.context?.appointment_status).toBe('cancelado');

  await createAppointment(canceledPatient.id, seeded.serviceId, '2030-03-04T15:00:00-03:00');
  const afterReschedule = await a.rpc('list_relationship_opportunities_v2', { p_category: 'reschedule', p_search: canceledPatient.name, p_include_snoozed: false, p_limit: 50, p_offset: 0 });
  expect(afterReschedule.error).toBeNull();
  expect(afterReschedule.data).toEqual([]);

  const noShowPatient = await createPatient(`E2E Falta ${randomUUID().slice(0, 8)}`, '+55 43 99999-3030');
  const noShow = await createAppointment(noShowPatient.id, seeded.serviceId, '2030-02-05T15:00:00-03:00');
  const noShowResult = await a.from('appointments').update({ status: 'nao_compareceu' }).eq('id', noShow.id).select('id').single();
  expect(noShowResult.error).toBeNull();
  const noShowRecovery = await a.rpc('list_relationship_opportunities_v2', { p_category: 'reschedule', p_search: noShowPatient.name, p_include_snoozed: false, p_limit: 50, p_offset: 0 });
  expect(noShowRecovery.error).toBeNull();
  expect(noShowRecovery.data?.[0]?.opportunities?.[0]?.context?.appointment_status).toBe('nao_compareceu');

  const dismissed = await a.rpc('dismiss_appointment_recovery_v1', { p_appointment_id: noShow.id });
  expect(dismissed.error).toBeNull();
  expect(dismissed.data).toBe(true);
  const hidden = await a.rpc('list_relationship_opportunities_v2', { p_category: 'reschedule', p_search: noShowPatient.name, p_include_snoozed: false, p_limit: 50, p_offset: 0 });
  expect(hidden.data).toEqual([]);
});

test('canonical appointment overlap remains the final double-booking guard', async () => {
  const seeded = await state();
  const a = await signedInClient('a');
  const firstPatient = await createPatient(`E2E Slot A ${randomUUID().slice(0, 8)}`, '+55 43 99999-4040');
  const secondPatient = await createPatient(`E2E Slot B ${randomUUID().slice(0, 8)}`, '+55 43 99999-5050');
  await createAppointment(firstPatient.id, seeded.serviceId, '2031-01-15T14:00:00-03:00');
  const collision = await a.from('appointments').insert({ patient_id: secondPatient.id, service_id: seeded.serviceId, scheduled_at: '2031-01-15T14:00:00-03:00', duration_minutes: 60 }).select('id');
  expect(collision.error).not.toBeNull();
  expect(collision.error?.code).toBe('23P01');
});

test('Patient 360 waitlist and Relationship Reagendar remain touch-usable on phone and iPad widths', async ({ page }) => {
  const seeded = await state();
  const a = await signedInClient('a');
  const waitlist = await a.rpc('upsert_appointment_waitlist_entry_v1', {
    p_patient_id: seeded.patientId, p_service_id: seeded.serviceId, p_source_appointment_id: null,
    p_preferred_period: null, p_preferred_weekdays: null, p_expires_on: null, p_notes: 'E2E Patient 360',
  });
  expect(waitlist.error).toBeNull();

  await browserLogin(page);
  for (const viewport of [{ width: 390, height: 844 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport);
    await page.goto(`/pacientes/${seeded.patientId}`);
    await expect(page.getByText('Lista de encaixe', { exact: true })).toBeVisible();
    const edit = page.getByRole('button', { name: 'Editar', exact: true }).last();
    await expect(edit).toBeVisible();
    const box = await edit.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewport.width + 1);
  }

  await page.goto('/relacionamento');
  await expect(page.getByRole('button', { name: /Reagendar/ })).toBeVisible();
});
