import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { signedInClient } from './helpers';

type Client = Awaited<ReturnType<typeof signedInClient>>;

async function createMaterial(client: Client, name: string) {
  const result = await client.rpc('create_material_v1', {
    p_idempotency_key: randomUUID(),
    p_name: name,
    p_unit_label: 'un.',
    p_unit_cost: 1.5,
    p_initial_stock: 10,
    p_minimum_stock: 0,
    p_active: true,
  });
  expect(result.error).toBeNull();
  return (result.data as { id: string }).id;
}

test.describe.serial('permanent material deletion', () => {
  let client: Client;

  test.beforeAll(async () => {
    client = await signedInClient('a');
  });

  test('permanently deletes an unused material and its creation ledger row', async () => {
    const materialId = await createMaterial(client, `MAT DELETE UNUSED ${randomUUID()}`);

    const before = await client.from('inventory_movements').select('movement_type').eq('material_id', materialId);
    expect(before.error).toBeNull();
    expect(before.data?.map(row => row.movement_type)).toEqual(['initial_stock']);

    const removed = await client.rpc('delete_material_v1', { p_material_id: materialId });
    expect(removed.error).toBeNull();

    const material = await client.from('materials').select('id').eq('id', materialId);
    expect(material.error).toBeNull();
    expect(material.data).toEqual([]);

    const movements = await client.from('inventory_movements').select('id').eq('material_id', materialId);
    expect(movements.error).toBeNull();
    expect(movements.data).toEqual([]);
  });

  test('refuses permanent deletion after a real stock movement', async () => {
    const materialId = await createMaterial(client, `MAT DELETE HISTORY ${randomUUID()}`);

    const entry = await client.rpc('record_material_stock_entry_v1', {
      p_idempotency_key: randomUUID(),
      p_material_id: materialId,
      p_quantity: 2,
      p_reason: 'Reposição E2E',
    });
    expect(entry.error).toBeNull();

    const removed = await client.rpc('delete_material_v1', { p_material_id: materialId });
    expect(removed.error).not.toBeNull();
    expect(`${removed.error?.message} ${removed.error?.details}`).toContain('MATERIAL_DELETE_HAS_HISTORY');

    const material = await client.from('materials').select('id').eq('id', materialId).single();
    expect(material.error).toBeNull();
    expect(material.data?.id).toBe(materialId);
  });
});
