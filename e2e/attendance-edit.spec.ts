import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { signedInClient } from './helpers';

type Client = Awaited<ReturnType<typeof signedInClient>>;

async function createPatient(client: Client, suffix: string) {
  const { data, error } = await client.from('patients').insert({ name: `EDIT E2E ${suffix}` }).select('id').single();
  expect(error).toBeNull();
  return data!.id as string;
}

async function createService(client: Client, name: string, price = 100, cost = 10) {
  const { data, error } = await client.from('services').insert({
    name, type: 'servico', price, cost_per_unit: cost, cost_is_configured: true, active: true, is_injectable: false,
  }).select('id').single();
  expect(error).toBeNull();
  return data!.id as string;
}

async function createMaterial(client: Client, name: string, stock: number, cost: number) {
  const result = await client.rpc('create_material_v1', {
    p_idempotency_key: randomUUID(), p_name: name, p_unit_label: 'un.', p_unit_cost: cost,
    p_initial_stock: stock, p_minimum_stock: 0, p_active: true,
  });
  expect(result.error).toBeNull();
  return (result.data as { id: string }).id;
}

const payment = (amount: number) => [{
  method: 'pix', base_amount: amount, amount, card_brand: null, installments: 1,
  fee_pct: null, fee_value: null, net_amount: amount, absorve_taxa: true, scheduled_date: null,
}];

async function stock(client: Client, materialId: string) {
  const { data, error } = await client.from('materials').select('stock_quantity').eq('id', materialId).single();
  expect(error).toBeNull();
  return Number(data!.stock_quantity);
}

test.describe.serial('editable existing attendance v1', () => {
  let client: Client;
  let patientId: string;
  let serviceId: string;
  let materialA: string;
  let materialB: string;
  let procedureId: string;
  let paidAt: string;

  test.beforeAll(async () => {
    client = await signedInClient('a');
    patientId = await createPatient(client, randomUUID());
    serviceId = await createService(client, `EDIT E2E Service ${randomUUID()}`);
    materialA = await createMaterial(client, `EDIT E2E Material A ${randomUUID()}`, 10, 2);
    materialB = await createMaterial(client, `EDIT E2E Material B ${randomUUID()}`, 5, 3);

    const created = await client.rpc('create_procedure_v5', {
      p_idempotency_key: randomUUID(),
      p_patient_id: patientId,
      p_appointment_id: null,
      p_performed_at: new Date().toISOString(),
      p_items: [{ service_id: serviceId, qty: 1, final_price: 100 }],
      p_payment_entries: payment(100),
      p_injectable_maps: [],
      p_coverages: [],
      p_materials: [{ material_id: materialA, quantity: 2 }],
      p_clinical_minutes: 0,
      p_notes: 'antes da edição',
    });
    expect(created.error).toBeNull();
    procedureId = (created.data as { id: string }).id;
    const pay = await client.from('procedure_payments').select('paid_at').eq('procedure_id', procedureId).single();
    expect(pay.error).toBeNull();
    paidAt = pay.data!.paid_at!;
  });

  test('edits the same procedure, swaps materials, recalculates costs and records audit', async () => {
    expect(await stock(client, materialA)).toBe(8);
    expect(await stock(client, materialB)).toBe(5);

    const edited = await client.rpc('update_procedure_v1', {
      p_procedure_id: procedureId,
      p_expected_revision: 1,
      p_performed_at: new Date().toISOString(),
      p_items: [{ service_id: serviceId, qty: 1, final_price: 100, cost: 12 }],
      p_payment_entries: [{ ...payment(100)[0], paid_at: paidAt }],
      p_materials: [{ material_id: materialB, quantity: 1 }],
      p_clinical_minutes: 0,
      p_notes: 'depois da edição',
      p_reason: 'Correção E2E',
    });
    expect(edited.error, edited.error?.message).toBeNull();
    const row = edited.data as { id: string; revision: number; total_cost: number; notes: string };
    expect(row.id).toBe(procedureId);
    expect(Number(row.revision)).toBe(2);
    expect(Number(row.total_cost)).toBeCloseTo(15, 2);
    expect(row.notes).toBe('depois da edição');

    expect(await stock(client, materialA)).toBe(10);
    expect(await stock(client, materialB)).toBe(4);

    const materials = await client.from('procedure_materials').select('material_id,quantity,total_cost_snapshot').eq('procedure_id', procedureId);
    expect(materials.error).toBeNull();
    expect(materials.data).toHaveLength(1);
    expect(materials.data![0].material_id).toBe(materialB);
    expect(Number(materials.data![0].quantity)).toBe(1);
    expect(Number(materials.data![0].total_cost_snapshot)).toBeCloseTo(3, 2);

    const item = await client.from('procedure_items').select('cost_snapshot').eq('procedure_id', procedureId).eq('service_id', serviceId).single();
    expect(item.error).toBeNull();
    expect(Number(item.data!.cost_snapshot)).toBeCloseTo(12, 2);

    const movements = await client.from('inventory_movements').select('material_id,movement_type,quantity_delta').eq('procedure_id_snapshot', procedureId);
    expect(movements.error).toBeNull();
    expect(movements.data!.some(row => row.material_id === materialA && row.movement_type === 'procedure_edit_reversal' && Number(row.quantity_delta) === 2)).toBeTruthy();
    expect(movements.data!.some(row => row.material_id === materialB && row.movement_type === 'procedure_edit_consumption' && Number(row.quantity_delta) === -1)).toBeTruthy();

    const audit = await client.from('procedure_edit_events').select('revision,reason,before_snapshot,after_snapshot').eq('procedure_id_snapshot', procedureId);
    expect(audit.error).toBeNull();
    expect(audit.data).toHaveLength(1);
    expect(Number(audit.data![0].revision)).toBe(2);
    expect(audit.data![0].reason).toBe('Correção E2E');
  });

  test('insufficient stock rolls the whole edit back', async () => {
    const beforeA = await stock(client, materialA);
    const beforeB = await stock(client, materialB);
    const result = await client.rpc('update_procedure_v1', {
      p_procedure_id: procedureId,
      p_expected_revision: 2,
      p_performed_at: new Date().toISOString(),
      p_items: [{ service_id: serviceId, qty: 1, final_price: 100, cost: 12 }],
      p_payment_entries: [{ ...payment(100)[0], paid_at: paidAt }],
      p_materials: [{ material_id: materialB, quantity: 999 }],
      p_clinical_minutes: 0,
      p_notes: 'não deve persistir',
      p_reason: 'falha esperada',
    });
    expect(result.error).not.toBeNull();
    expect(`${result.error?.message} ${result.error?.details}`).toContain('MATERIAL_INSUFFICIENT_STOCK');
    expect(await stock(client, materialA)).toBe(beforeA);
    expect(await stock(client, materialB)).toBe(beforeB);

    const procedure = await client.from('procedures').select('revision,notes').eq('id', procedureId).single();
    expect(procedure.error).toBeNull();
    expect(Number(procedure.data!.revision)).toBe(2);
    expect(procedure.data!.notes).toBe('depois da edição');
  });

  test('stale revision and cross-tenant edits are refused', async () => {
    const stale = await client.rpc('update_procedure_v1', {
      p_procedure_id: procedureId,
      p_expected_revision: 1,
      p_performed_at: new Date().toISOString(),
      p_items: [{ service_id: serviceId, qty: 1, final_price: 100, cost: 12 }],
      p_payment_entries: [{ ...payment(100)[0], paid_at: paidAt }],
      p_materials: [{ material_id: materialB, quantity: 1 }],
      p_clinical_minutes: 0,
      p_notes: 'stale',
      p_reason: 'stale',
    });
    expect(stale.error).not.toBeNull();
    expect(stale.error?.message).toContain('ATTENDANCE_EDIT_CONFLICT');

    const tenantB = await signedInClient('b');
    const forbidden = await tenantB.rpc('update_procedure_v1', {
      p_procedure_id: procedureId,
      p_expected_revision: 2,
      p_performed_at: new Date().toISOString(),
      p_items: [{ service_id: serviceId, qty: 1, final_price: 100, cost: 12 }],
      p_payment_entries: [{ ...payment(100)[0], paid_at: paidAt }],
      p_materials: [],
      p_clinical_minutes: 0,
      p_notes: 'forbidden',
      p_reason: 'forbidden',
    });
    expect(forbidden.error).not.toBeNull();
    expect(forbidden.error?.message).toContain('ATTENDANCE_PROCEDURE_FORBIDDEN');
  });
});
