import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { signedInClient } from './helpers';

type E2EState = {
  users: { a: string; b: string };
  serviceId: string;
  patientId: string;
  appointmentId: string;
};

async function state(): Promise<E2EState> {
  return JSON.parse(await fs.readFile('.e2e-state.json', 'utf8')) as E2EState;
}

test('tenant B cannot read, mutate, delete or reference tenant A clinical/operational rows', async () => {
  const seeded = await state();
  const b = await signedInClient('b');

  const patientRead = await b.from('patients').select('id').eq('id', seeded.patientId);
  expect(patientRead.error).toBeNull();
  expect(patientRead.data).toEqual([]);

  const patientUpdate = await b.from('patients').update({ profession: 'E2E SHOULD NOT WRITE' }).eq('id', seeded.patientId).select('id');
  expect(patientUpdate.error).toBeNull();
  expect(patientUpdate.data).toEqual([]);

  const patientDelete = await b.from('patients').delete().eq('id', seeded.patientId).select('id');
  expect(patientDelete.error).toBeNull();
  expect(patientDelete.data).toEqual([]);

  const foreignInsert = await b.from('patients').insert({ user_id: seeded.users.a, name: 'E2E SHOULD FAIL' }).select('id');
  expect(foreignInsert.error).not.toBeNull();

  const appointmentRead = await b.from('appointments').select('id').eq('id', seeded.appointmentId);
  expect(appointmentRead.error).toBeNull();
  expect(appointmentRead.data).toEqual([]);

  const crossTenantAppointment = await b.from('appointments').insert({
    patient_id: seeded.patientId,
    service_id: seeded.serviceId,
    scheduled_at: '2030-01-16T13:00:00.000Z',
    duration_minutes: 60,
    end_at: '2030-01-16T14:00:00.000Z',
  }).select('id');
  expect(crossTenantAppointment.error).not.toBeNull();

  const patient360 = await b.rpc('get_patient_360_overview_v2', { p_patient_id: seeded.patientId });
  expect(patient360.error).not.toBeNull();
});

test('Storage blocks tenant B list/download/signed-url/upload/delete attempts against tenant A', async () => {
  const seeded = await state();
  const a = await signedInClient('a');
  const b = await signedInClient('b');
  const folder = `${seeded.users.a}/patients/${seeded.patientId}/photos`;
  const path = `${folder}/e2e-security-original.png`;
  const bytes = Buffer.from('E2E TEST non-sensitive image fixture');

  const uploaded = await a.storage.from('patient-photos').upload(path, bytes, { contentType: 'image/png', upsert: false });
  expect(uploaded.error).toBeNull();

  const listedByB = await b.storage.from('patient-photos').list(folder);
  expect(listedByB.error).toBeNull();
  expect(listedByB.data ?? []).toEqual([]);

  const downloadedByB = await b.storage.from('patient-photos').download(path);
  expect(downloadedByB.error).not.toBeNull();
  expect(downloadedByB.data).toBeNull();

  const signedByB = await b.storage.from('patient-photos').createSignedUrl(path, 60);
  expect(signedByB.error).not.toBeNull();

  const overwrittenByB = await b.storage.from('patient-photos').upload(path, Buffer.from('E2E SHOULD NOT WRITE'), {
    contentType: 'image/png',
    upsert: true,
  });
  expect(overwrittenByB.error).not.toBeNull();

  await b.storage.from('patient-photos').remove([path]);
  const stillOwnedByA = await a.storage.from('patient-photos').download(path);
  expect(stillOwnedByA.error).toBeNull();
  expect(stillOwnedByA.data).not.toBeNull();

  const cleanup = await a.storage.from('patient-photos').remove([path]);
  expect(cleanup.error).toBeNull();
});

test('canonical attendance RPC is idempotent and generates isolated finance, return and aftercare records', async () => {
  const seeded = await state();
  const a = await signedInClient('a');
  const b = await signedInClient('b');
  const idempotencyKey = randomUUID();
  const args = {
    p_idempotency_key: idempotencyKey,
    p_patient_id: seeded.patientId,
    p_appointment_id: seeded.appointmentId,
    p_performed_at: '2030-01-15T13:05:00.000Z',
    p_items: [{ service_id: seeded.serviceId, qty: 1, final_price: 100 }],
    p_payment_entries: [{
      method: 'pix',
      base_amount: 100,
      amount: 100,
      card_brand: null,
      installments: 1,
      fee_pct: 0,
      fee_value: 0,
      net_amount: 100,
      absorve_taxa: false,
      scheduled_date: null,
    }],
    p_injectable_maps: [],
    p_notes: 'E2E TEST isolated attendance',
  };

  const [first, second] = await Promise.all([
    a.rpc('create_procedure_v2', args),
    a.rpc('create_procedure_v2', args),
  ]);
  expect(first.error).toBeNull();
  expect(second.error).toBeNull();

  const firstRow = Array.isArray(first.data) ? first.data[0] : first.data;
  const secondRow = Array.isArray(second.data) ? second.data[0] : second.data;
  expect(firstRow?.id).toBeTruthy();
  expect(secondRow?.id).toBe(firstRow?.id);
  const procedureId = firstRow!.id as string;

  const procedureCount = await a.from('procedures').select('id').eq('idempotency_key', idempotencyKey);
  expect(procedureCount.error).toBeNull();
  expect(procedureCount.data).toHaveLength(1);

  const items = await a.from('procedure_items').select('id').eq('procedure_id', procedureId);
  expect(items.error).toBeNull();
  expect(items.data).toHaveLength(1);

  const payments = await a.from('procedure_payments').select('id').eq('procedure_id', procedureId);
  expect(payments.error).toBeNull();
  expect(payments.data).toHaveLength(1);

  const returnsA = await a.rpc('list_procedure_returns_v2');
  expect(returnsA.error).toBeNull();
  const generatedReturns = (returnsA.data ?? []).filter((row: { procedure_id?: string }) => row.procedure_id === procedureId);
  expect(generatedReturns).toHaveLength(1);
  expect(generatedReturns[0]?.return_type).toBe('clinical_return');

  const returnsB = await b.rpc('list_procedure_returns_v2');
  expect(returnsB.error).toBeNull();
  expect((returnsB.data ?? []).filter((row: { procedure_id?: string }) => row.procedure_id === procedureId)).toEqual([]);

  const plans = await a.from('procedure_followup_plans').select('id,status,photo_followup_snapshot').eq('procedure_id', procedureId);
  expect(plans.error).toBeNull();
  expect(plans.data).toHaveLength(1);
  expect(plans.data?.[0]?.photo_followup_snapshot).toBe(true);

  const tasks = await a.from('procedure_followup_tasks').select('id,task_type,status').eq('procedure_id', procedureId);
  expect(tasks.error).toBeNull();
  expect(tasks.data).toHaveLength(1);

  const procedureAsB = await b.from('procedures').select('id').eq('id', procedureId);
  expect(procedureAsB.error).toBeNull();
  expect(procedureAsB.data).toEqual([]);

  const itemAsB = await b.from('procedure_items').select('id').eq('procedure_id', procedureId);
  expect(itemAsB.error).toBeNull();
  expect(itemAsB.data).toEqual([]);

  const paymentAsB = await b.from('procedure_payments').select('id').eq('procedure_id', procedureId);
  expect(paymentAsB.error).toBeNull();
  expect(paymentAsB.data).toEqual([]);

  const plansAsB = await b.from('procedure_followup_plans').select('id').eq('procedure_id', procedureId);
  expect(plansAsB.error).toBeNull();
  expect(plansAsB.data).toEqual([]);

  const tasksAsB = await b.from('procedure_followup_tasks').select('id').eq('procedure_id', procedureId);
  expect(tasksAsB.error).toBeNull();
  expect(tasksAsB.data).toEqual([]);
});
