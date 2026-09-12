import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { signedInClient } from './helpers';

test('attendance editor owner can load procedure and every linked-history lookup', async () => {
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

  // Mirror the exact reads performed by EditAttendancePage before it renders.
  const loaded = await client.from('procedures').select(`
    *,
    procedure_items:procedure_items!procedure_items_procedure_owner_fkey(*),
    procedure_payments:procedure_payments!procedure_payments_procedure_owner_fkey(*),
    procedure_materials:procedure_materials!procedure_materials_procedure_owner_fkey(*)
  `).eq('id', procedureId).single();
  expect(loaded.error, loaded.error?.message).toBeNull();

  const row = loaded.data as { patient_id: string; procedure_items: Array<{ id: string }> };
  expect(row.procedure_items).toHaveLength(1);
  const itemIds = row.procedure_items.map(item => item.id);

  const [redemptions, applications, returns, patientRead] = await Promise.all([
    client.from('package_redemptions').select('procedure_item_id_snapshot,coverage_value_snapshot').eq('procedure_id_snapshot', procedureId),
    client.from('injectable_applications').select('procedure_item_id').in('procedure_item_id', itemIds),
    client.from('procedure_returns').select('procedure_item_id').in('procedure_item_id', itemIds),
    client.from('patients').select('name').eq('id', row.patient_id).single(),
  ]);

  expect(redemptions.error, redemptions.error?.message).toBeNull();
  expect(applications.error, applications.error?.message).toBeNull();
  expect(returns.error, returns.error?.message).toBeNull();
  expect(patientRead.error, patientRead.error?.message).toBeNull();
  expect(patientRead.data?.name).toBe(patientName);
});
