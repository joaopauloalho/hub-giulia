import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { browserLogin, signedInClient } from './helpers';

test('existing attendance editor loads an owner procedure instead of failing on return-history lookup', async ({ page }) => {
  const client = await signedInClient('a');
  const suffix = randomUUID();
  const patientName = `EDIT LOAD E2E ${suffix}`;

  const patient = await client.from('patients').insert({ name: patientName }).select('id').single();
  expect(patient.error).toBeNull();

  const service = await client.from('services').insert({
    name: `EDIT LOAD Service ${suffix}`,
    type: 'servico',
    price: 0,
    cost_per_unit: 5,
    cost_is_configured: true,
    active: true,
    is_injectable: false,
  }).select('id').single();
  expect(service.error).toBeNull();

  const material = await client.rpc('create_material_v1', {
    p_idempotency_key: randomUUID(),
    p_name: `EDIT LOAD Material ${suffix}`,
    p_unit_label: 'un.',
    p_unit_cost: 2,
    p_initial_stock: 10,
    p_minimum_stock: 0,
    p_active: true,
  });
  expect(material.error).toBeNull();

  const created = await client.rpc('create_procedure_v5', {
    p_idempotency_key: randomUUID(),
    p_patient_id: patient.data!.id,
    p_appointment_id: null,
    p_performed_at: new Date().toISOString(),
    p_items: [{ service_id: service.data!.id, qty: 1, final_price: 0 }],
    p_payment_entries: [],
    p_injectable_maps: [],
    p_coverages: [],
    p_materials: [{ material_id: (material.data as { id: string }).id, quantity: 1 }],
    p_clinical_minutes: 0,
    p_notes: 'carregamento do editor',
  });
  expect(created.error, created.error?.message).toBeNull();
  const procedureId = (created.data as { id: string }).id;

  await browserLogin(page, 'a');
  await page.goto(`/registrar?edit=${procedureId}`);

  await expect(page.getByRole('heading', { name: 'Editar atendimento' })).toBeVisible();
  await expect(page.getByText(patientName, { exact: false })).toBeVisible();
  await expect(page.getByText('Não foi possível carregar este atendimento para edição.')).toHaveCount(0);
});
