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

test('procedure idempotency rejects a parallel duplicate and finance remains tenant-isolated', async () => {
  const seeded = await state();
  const a = await signedInClient('a');
  const b = await signedInClient('b');
  const idempotencyKey = randomUUID();
  const procedurePayload = {
    patient_id: seeded.patientId,
    appointment_id: seeded.appointmentId,
    services_ids: [seeded.serviceId],
    total_value: 100,
    total_cost: 20,
    payment_method: 'pix',
    net_value: 100,
    gross_value: 100,
    covered_value: 0,
    idempotency_key: idempotencyKey,
  };

  const attempts = await Promise.all([
    a.from('procedures').insert(procedurePayload).select('id').single(),
    a.from('procedures').insert(procedurePayload).select('id').single(),
  ]);
  const successes = attempts.filter(result => !result.error && result.data);
  const failures = attempts.filter(result => result.error);
  expect(successes).toHaveLength(1);
  expect(failures).toHaveLength(1);

  const procedureId = successes[0].data!.id;
  const item = await a.from('procedure_items').insert({
    procedure_id: procedureId,
    service_id: seeded.serviceId,
    name: 'E2E TEST Service',
    qty: 1,
    list_price: 100,
    final_price: 100,
    discount: 0,
    cost_snapshot: 20,
    coverage_value_snapshot: 0,
    amount_due_snapshot: 100,
  }).select('id').single();
  expect(item.error).toBeNull();

  const payment = await a.from('procedure_payments').insert({
    procedure_id: procedureId,
    method: 'pix',
    amount: 100,
    net_amount: 100,
    paid_at: new Date().toISOString(),
  }).select('id').single();
  expect(payment.error).toBeNull();

  const procedureAsB = await b.from('procedures').select('id').eq('id', procedureId);
  expect(procedureAsB.error).toBeNull();
  expect(procedureAsB.data).toEqual([]);

  const itemAsB = await b.from('procedure_items').select('id').eq('id', item.data!.id);
  expect(itemAsB.error).toBeNull();
  expect(itemAsB.data).toEqual([]);

  const paymentAsB = await b.from('procedure_payments').select('id').eq('id', payment.data!.id);
  expect(paymentAsB.error).toBeNull();
  expect(paymentAsB.data).toEqual([]);
});
