import fs from 'node:fs/promises';
import { adminClient, E2E_USERS, signedInClient } from './helpers';

async function assertNoError(error: { message?: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message ?? 'unknown isolated E2E setup error'}`);
}

export default async function globalSetup() {
  const admin = adminClient();

  const { data: existing, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  await assertNoError(listError, 'list local E2E users');
  for (const user of existing?.users ?? []) {
    if (Object.values(E2E_USERS).some(item => item.email === user.email)) {
      const { error } = await admin.auth.admin.deleteUser(user.id);
      await assertNoError(error, 'reset local E2E user');
    }
  }

  const created: Record<'a' | 'b', string> = { a: '', b: '' };
  for (const key of ['a', 'b'] as const) {
    const credentials = E2E_USERS[key];
    const { data, error } = await admin.auth.admin.createUser({
      email: credentials.email,
      password: credentials.password,
      email_confirm: true,
    });
    await assertNoError(error, `create local E2E user ${key}`);
    if (!data.user) throw new Error(`create local E2E user ${key}: no user returned`);
    created[key] = data.user.id;
  }

  // Keep service_role restricted to Auth administration. Application fixtures are
  // written through User A so RLS/defaults/grants are exercised exactly as runtime.
  const tenantA = await signedInClient('a');

  const { data: service, error: serviceError } = await tenantA.from('services').insert({
    name: 'E2E TEST Service',
    type: 'servico',
    price: 100,
    cost_per_unit: 20,
    duration_minutes: 60,
    active: true,
    is_injectable: true,
    return_enabled: true,
    return_type: 'clinical_return',
    return_min_days: 7,
    return_max_days: 14,
  }).select('id').single();
  await assertNoError(serviceError, 'seed E2E service');

  const { data: injectableProduct, error: injectableProductError } = await tenantA.from('injectable_products').insert({
    name: 'E2E TEST Injectable Product',
    category: 'toxina',
    brand: 'E2E',
    substance: 'E2E TEST substance',
    default_unit: 'U',
    presentation: 'E2E TEST vial',
    active: true,
  }).select('id').single();
  await assertNoError(injectableProductError, 'seed E2E injectable product');

  const aftercare = await tenantA.rpc('save_service_aftercare_protocol_v1', {
    p_service_id: service!.id,
    p_enabled: true,
    p_instructions: 'E2E TEST isolated aftercare instructions',
    p_photo_followup: true,
    p_steps: [{ offset_days: 1, label: 'E2E TEST check-in' }],
    p_name: 'E2E TEST Aftercare',
  });
  await assertNoError(aftercare.error, 'seed E2E aftercare protocol');

  const { data: patient, error: patientError } = await tenantA.from('patients').insert({
    name: 'E2E TEST Seed Patient',
    phone: '43999990000',
    email: 'seed-patient@hub-giulia.local',
  }).select('id').single();
  await assertNoError(patientError, 'seed E2E patient');

  const scheduledAt = '2030-01-15T13:00:00.000Z';
  const endAt = '2030-01-15T14:00:00.000Z';
  const { data: appointment, error: appointmentError } = await tenantA.from('appointments').insert({
    patient_id: patient!.id,
    service_id: service!.id,
    scheduled_at: scheduledAt,
    duration_minutes: 60,
    end_at: endAt,
    notes: 'E2E TEST isolated appointment',
  }).select('id').single();
  await assertNoError(appointmentError, 'seed E2E appointment');

  const { data: contact, error: contactError } = await tenantA.from('contacts').insert({
    name: 'E2E TEST Contact',
    phone: '43999990001',
    source: 'other',
    patient_id: patient!.id,
  }).select('id').single();
  await assertNoError(contactError, 'seed E2E CRM contact');

  const { data: deal, error: dealError } = await tenantA.from('deals').insert({
    contact_id: contact!.id,
    title: 'E2E TEST Deal',
    value: 100,
    stage: 'new',
  }).select('id').single();
  await assertNoError(dealError, 'seed E2E CRM deal');

  await fs.writeFile('.e2e-state.json', JSON.stringify({
    users: created,
    serviceId: service!.id,
    injectableProductId: injectableProduct!.id,
    patientId: patient!.id,
    appointmentId: appointment!.id,
    contactId: contact!.id,
    dealId: deal!.id,
  }), 'utf8');
}
