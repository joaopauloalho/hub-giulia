import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { signedInClient } from './helpers';

type Client = Awaited<ReturnType<typeof signedInClient>>;

function payment(amount: number) {
  return [{
    method: 'pix',
    base_amount: amount,
    amount,
    card_brand: null,
    installments: 1,
    fee_pct: 0,
    fee_value: 0,
    net_amount: amount,
    absorve_taxa: true,
    scheduled_date: null,
  }];
}

async function createPatient(client: Client, suffix: string) {
  const { data, error } = await client.from('patients').insert({
    name: `MAT E2E ${suffix}`,
    phone: `4399${Math.floor(Math.random() * 9_000_000 + 1_000_000)}`,
  }).select('id').single();
  expect(error).toBeNull();
  return data!.id as string;
}

async function createService(client: Client, name: string, cost = 10, injectable = false) {
  const { data, error } = await client.from('services').insert({
    name,
    type: 'servico',
    price: 100,
    cost_per_unit: cost,
    cost_is_configured: true,
    active: true,
    is_injectable: injectable,
  }).select('id').single();
  expect(error).toBeNull();
  return data!.id as string;
}

async function createMaterial(client: Client, args: { name: string; cost: number; stock: number; minimum?: number }) {
  const key = randomUUID();
  const result = await client.rpc('create_material_v1', {
    p_idempotency_key: key,
    p_name: args.name,
    p_unit_label: 'un.',
    p_unit_cost: args.cost,
    p_initial_stock: args.stock,
    p_minimum_stock: args.minimum ?? 0,
    p_active: true,
  });
  expect(result.error, `create material ${args.name}`).toBeNull();
  return (result.data as { id: string }).id;
}

async function createProcedureV4(client: Client, args: {
  key?: string;
  performedAt?: string;
  patientId: string;
  serviceId: string;
  materials?: Array<{ material_id: string; quantity: number }>;
  coverages?: Array<{ service_id: string; package_item_id: string; quantity: number }>;
  paymentEntries?: ReturnType<typeof payment>;
}) {
  return client.rpc('create_procedure_v4', {
    p_idempotency_key: args.key ?? randomUUID(),
    p_patient_id: args.patientId,
    p_appointment_id: null,
    p_performed_at: args.performedAt ?? new Date().toISOString(),
    p_items: [{ service_id: args.serviceId, qty: 1, final_price: 100 }],
    p_payment_entries: args.paymentEntries ?? payment(100),
    p_injectable_maps: [],
    p_coverages: args.coverages ?? [],
    p_materials: args.materials ?? [],
    p_notes: 'materials inventory e2e',
  });
}

async function stock(client: Client, materialId: string) {
  const { data, error } = await client.from('materials').select('stock_quantity,unit_cost').eq('id', materialId).single();
  expect(error).toBeNull();
  return { quantity: Number(data!.stock_quantity), cost: Number(data!.unit_cost) };
}

test.describe.serial('materials inventory v1', () => {
  let client: Client;
  let patientId: string;
  let serviceId: string;

  test.beforeAll(async () => {
    client = await signedInClient('a');
    patientId = await createPatient(client, 'Patient');
    serviceId = await createService(client, 'MAT E2E Non Injectable', 10, false);
  });

  test('creates initial balance and audited initial movement', async () => {
    const materialId = await createMaterial(client, { name: 'MAT E2E Initial Gaze', cost: 0.12, stock: 500, minimum: 100 });
    expect((await stock(client, materialId)).quantity).toBe(500);
    const movements = await client.from('inventory_movements').select('movement_type,quantity_delta,unit_cost_snapshot').eq('material_id', materialId).order('created_at');
    expect(movements.error).toBeNull();
    expect(movements.data).toHaveLength(1);
    expect(movements.data![0].movement_type).toBe('initial_stock');
    expect(Number(movements.data![0].quantity_delta)).toBe(500);
    expect(Number(movements.data![0].unit_cost_snapshot)).toBeCloseTo(0.12, 4);
  });

  test('stock entry and manual adjustment update balance through ledger', async () => {
    const materialId = await createMaterial(client, { name: 'MAT E2E Ledger', cost: 1.8, stock: 100 });
    const entry = await client.rpc('record_material_stock_entry_v1', { p_idempotency_key: randomUUID(), p_material_id: materialId, p_quantity: 50, p_reason: 'Reposição E2E' });
    expect(entry.error).toBeNull();
    expect((await stock(client, materialId)).quantity).toBe(150);

    const adjust = await client.rpc('adjust_material_stock_v1', { p_idempotency_key: randomUUID(), p_material_id: materialId, p_counted_quantity: 144, p_reason: 'Ajuste de inventário E2E' });
    expect(adjust.error).toBeNull();
    expect((await stock(client, materialId)).quantity).toBe(144);

    const ledger = await client.from('inventory_movements').select('movement_type,quantity_delta,reason').eq('material_id', materialId).order('created_at');
    expect(ledger.error).toBeNull();
    expect(ledger.data!.map(row => row.movement_type)).toEqual(['initial_stock', 'stock_entry', 'manual_adjustment']);
    expect(Number(ledger.data![1].quantity_delta)).toBe(50);
    expect(Number(ledger.data![2].quantity_delta)).toBe(-6);
  });

  test('non-injectable attendance consumes multiple materials and adds snapshots to authoritative total cost', async () => {
    const syringeId = await createMaterial(client, { name: 'MAT E2E Seringa 1 ml', cost: 1.8, stock: 100, minimum: 20 });
    const gauzeId = await createMaterial(client, { name: 'MAT E2E Gaze', cost: 0.12, stock: 500, minimum: 100 });
    const created = await createProcedureV4(client, { patientId, serviceId, materials: [{ material_id: syringeId, quantity: 2 }, { material_id: gauzeId, quantity: 8 }] });
    expect(created.error).toBeNull();
    const procedureId = (created.data as { id: string }).id;

    expect((await stock(client, syringeId)).quantity).toBe(98);
    expect((await stock(client, gauzeId)).quantity).toBe(492);

    const rows = await client.from('procedure_materials').select('material_id,quantity,unit_cost_snapshot,total_cost_snapshot,material_name_snapshot').eq('procedure_id', procedureId).order('material_name_snapshot');
    expect(rows.error).toBeNull();
    expect(rows.data).toHaveLength(2);
    const syringe = rows.data!.find(row => row.material_id === syringeId)!;
    const gauze = rows.data!.find(row => row.material_id === gauzeId)!;
    expect(Number(syringe.unit_cost_snapshot)).toBeCloseTo(1.8, 4);
    expect(Number(syringe.total_cost_snapshot)).toBeCloseTo(3.6, 2);
    expect(Number(gauze.unit_cost_snapshot)).toBeCloseTo(0.12, 4);
    expect(Number(gauze.total_cost_snapshot)).toBeCloseTo(0.96, 2);

    const procedure = await client.from('procedures').select('total_cost').eq('id', procedureId).single();
    expect(procedure.error).toBeNull();
    expect(Number(procedure.data!.total_cost)).toBeCloseTo(14.56, 2);
  });

  test('material cost change affects only future snapshots', async () => {
    const materialId = await createMaterial(client, { name: 'MAT E2E Cost Snapshot', cost: 1.8, stock: 10 });
    const first = await createProcedureV4(client, { patientId, serviceId, materials: [{ material_id: materialId, quantity: 1 }] });
    expect(first.error).toBeNull();
    const firstId = (first.data as { id: string }).id;

    const update = await client.rpc('update_material_v1', { p_material_id: materialId, p_name: 'MAT E2E Cost Snapshot', p_unit_label: 'un.', p_unit_cost: 2, p_minimum_stock: 0, p_active: true });
    expect(update.error).toBeNull();
    const second = await createProcedureV4(client, { patientId, serviceId, materials: [{ material_id: materialId, quantity: 1 }] });
    expect(second.error).toBeNull();
    const secondId = (second.data as { id: string }).id;

    const oldRow = await client.from('procedure_materials').select('unit_cost_snapshot').eq('procedure_id', firstId).single();
    const newRow = await client.from('procedure_materials').select('unit_cost_snapshot').eq('procedure_id', secondId).single();
    expect(Number(oldRow.data!.unit_cost_snapshot)).toBeCloseTo(1.8, 4);
    expect(Number(newRow.data!.unit_cost_snapshot)).toBeCloseTo(2, 4);
  });

  test('insufficient stock rejects the entire transaction', async () => {
    const materialId = await createMaterial(client, { name: 'MAT E2E Insufficient', cost: 3, stock: 1 });
    const key = randomUUID();
    const result = await createProcedureV4(client, { key, patientId, serviceId, materials: [{ material_id: materialId, quantity: 2 }] });
    expect(result.error).not.toBeNull();
    expect(`${result.error?.message} ${result.error?.details}`).toContain('MATERIAL_INSUFFICIENT_STOCK');
    expect((await stock(client, materialId)).quantity).toBe(1);
    const procedures = await client.from('procedures').select('id').eq('idempotency_key', key);
    expect(procedures.error).toBeNull();
    expect(procedures.data).toHaveLength(0);
    const consumed = await client.from('inventory_movements').select('id').eq('material_id', materialId).eq('movement_type', 'procedure_consumption');
    expect(consumed.data).toHaveLength(0);
  });

  test('same idempotency key never consumes twice and changed materials conflict', async () => {
    const materialId = await createMaterial(client, { name: 'MAT E2E Idempotent', cost: 2, stock: 5 });
    const key = randomUUID();
    const performedAt = new Date().toISOString();
    const args = { key, performedAt, patientId, serviceId, materials: [{ material_id: materialId, quantity: 2 }] };
    const first = await createProcedureV4(client, args);
    expect(first.error).toBeNull();
    const firstId = (first.data as { id: string }).id;
    expect((await stock(client, materialId)).quantity).toBe(3);

    const retry = await createProcedureV4(client, args);
    expect(retry.error).toBeNull();
    expect((retry.data as { id: string }).id).toBe(firstId);
    expect((await stock(client, materialId)).quantity).toBe(3);

    const changed = await createProcedureV4(client, { ...args, materials: [{ material_id: materialId, quantity: 1 }] });
    expect(changed.error).not.toBeNull();
    expect(`${changed.error?.message} ${changed.error?.details}`.toLowerCase()).toContain('idempot');
    expect((await stock(client, materialId)).quantity).toBe(3);
  });

  test('exact stock can be consumed without going negative', async () => {
    const materialId = await createMaterial(client, { name: 'MAT E2E Exact Stock', cost: 1, stock: 2 });
    const result = await createProcedureV4(client, { patientId, serviceId, materials: [{ material_id: materialId, quantity: 2 }] });
    expect(result.error).toBeNull();
    expect((await stock(client, materialId)).quantity).toBe(0);
  });

  test('concurrent attempts for the last unit allow at most one commit', async () => {
    const materialId = await createMaterial(client, { name: 'MAT E2E Concurrent Last Unit', cost: 1, stock: 1 });
    const [a, b] = await Promise.all([
      createProcedureV4(client, { patientId, serviceId, materials: [{ material_id: materialId, quantity: 1 }] }),
      createProcedureV4(client, { patientId, serviceId, materials: [{ material_id: materialId, quantity: 1 }] }),
    ]);
    const successes = [a, b].filter(result => !result.error);
    const failures = [a, b].filter(result => result.error);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect((await stock(client, materialId)).quantity).toBe(0);
  });

  test('deleting a procedure restores stock once with compensating ledger preserved', async () => {
    const materialId = await createMaterial(client, { name: 'MAT E2E Reversal', cost: 4, stock: 10 });
    const created = await createProcedureV4(client, { patientId, serviceId, materials: [{ material_id: materialId, quantity: 3 }] });
    expect(created.error).toBeNull();
    const procedureId = (created.data as { id: string }).id;
    expect((await stock(client, materialId)).quantity).toBe(7);

    const deleted = await client.from('procedures').delete().eq('id', procedureId);
    expect(deleted.error).toBeNull();
    expect((await stock(client, materialId)).quantity).toBe(10);

    const ledger = await client.from('inventory_movements').select('movement_type,quantity_delta,procedure_id_snapshot').eq('material_id', materialId).order('created_at');
    expect(ledger.error).toBeNull();
    expect(ledger.data!.filter(row => row.movement_type === 'procedure_consumption')).toHaveLength(1);
    expect(ledger.data!.filter(row => row.movement_type === 'procedure_reversal')).toHaveLength(1);
    expect(Number(ledger.data!.find(row => row.movement_type === 'procedure_reversal')!.quantity_delta)).toBe(3);
    expect(ledger.data!.find(row => row.movement_type === 'procedure_reversal')!.procedure_id_snapshot).toBe(procedureId);

    const deleteAgain = await client.from('procedures').delete().eq('id', procedureId);
    expect(deleteAgain.error).toBeNull();
    expect((await stock(client, materialId)).quantity).toBe(10);
    const reversals = await client.from('inventory_movements').select('id').eq('material_id', materialId).eq('movement_type', 'procedure_reversal');
    expect(reversals.data).toHaveLength(1);
  });

  test('attendance without materials stays compatible', async () => {
    const created = await createProcedureV4(client, { patientId, serviceId, materials: [] });
    expect(created.error).toBeNull();
    const procedureId = (created.data as { id: string }).id;
    const rows = await client.from('procedure_materials').select('id').eq('procedure_id', procedureId);
    expect(rows.error).toBeNull();
    expect(rows.data).toEqual([]);
    const procedure = await client.from('procedures').select('total_cost').eq('id', procedureId).single();
    expect(Number(procedure.data!.total_cost)).toBeCloseTo(10, 2);
  });

  test('cross-tenant cannot see or consume another owner material', async () => {
    const materialId = await createMaterial(client, { name: 'MAT E2E Tenant A Only', cost: 5, stock: 5 });
    const tenantB = await signedInClient('b');
    const visible = await tenantB.from('materials').select('id').eq('id', materialId);
    expect(visible.error).toBeNull();
    expect(visible.data).toEqual([]);

    const patientB = await createPatient(tenantB, 'Tenant B Patient');
    const serviceB = await createService(tenantB, 'MAT E2E Tenant B Service');
    const attempt = await createProcedureV4(tenantB, { patientId: patientB, serviceId: serviceB, materials: [{ material_id: materialId, quantity: 1 }] });
    expect(attempt.error).not.toBeNull();
    expect((await stock(client, materialId)).quantity).toBe(5);
  });

  test('v4 package coverage remains compatible with material consumption', async () => {
    const packageServiceId = await createService(client, 'MAT E2E Package Service', 7, false);
    const materialId = await createMaterial(client, { name: 'MAT E2E Package Material', cost: 2, stock: 5 });
    const pkg = await client.rpc('create_manual_package_v1', {
      p_idempotency_key: randomUUID(), p_patient_id: patientId, p_title: 'MAT E2E Package', p_source_type: 'manual',
      p_items: [{ service_id: packageServiceId, quantity: 1, commercial_value: 100 }], p_valid_from: '2026-08-01', p_valid_until: '2027-08-01', p_reason: 'materials e2e', p_notes: null,
    });
    expect(pkg.error).toBeNull();
    const packageId = (pkg.data as { id: string }).id;
    expect((await client.rpc('record_package_sale_v1', { p_package_id: packageId, p_idempotency_key: randomUUID(), p_payment_entries: payment(100) })).error).toBeNull();
    expect((await client.rpc('activate_package_v1', { p_package_id: packageId, p_idempotency_key: randomUUID() })).error).toBeNull();
    const item = await client.from('patient_package_items').select('id').eq('package_id', packageId).single();
    expect(item.error).toBeNull();

    const result = await createProcedureV4(client, {
      patientId, serviceId: packageServiceId, materials: [{ material_id: materialId, quantity: 1 }],
      coverages: [{ service_id: packageServiceId, package_item_id: item.data!.id, quantity: 1 }], paymentEntries: [],
    });
    expect(result.error).toBeNull();
    expect((await stock(client, materialId)).quantity).toBe(4);
    const procedureId = (result.data as { id: string }).id;
    const procedure = await client.from('procedures').select('total_cost').eq('id', procedureId).single();
    expect(Number(procedure.data!.total_cost)).toBeCloseTo(9, 2);
  });
});
