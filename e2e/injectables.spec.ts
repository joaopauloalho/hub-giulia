import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { signedInClient } from './helpers';

type E2EState = {
  serviceId: string;
  injectableProductId: string;
  patientId: string;
};
const readState = async () => JSON.parse(await fs.readFile('.e2e-state.json', 'utf8')) as E2EState;

test('injectable draft finalization is idempotent under parallel retry and tenant-isolated', async () => {
  const seeded = await readState();
  const a = await signedInClient('a');
  const b = await signedInClient('b');

  const procedureKey = randomUUID();
  const procedure = await a.rpc('create_procedure_v2', {
    p_idempotency_key: procedureKey,
    p_patient_id: seeded.patientId,
    p_appointment_id: null,
    p_performed_at: new Date().toISOString(),
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
    p_notes: 'E2E TEST injectable procedure',
  });
  expect(procedure.error).toBeNull();
  const procedureRow = Array.isArray(procedure.data) ? procedure.data[0] : procedure.data;
  expect(procedureRow?.id).toBeTruthy();
  const procedureId = procedureRow!.id as string;

  const draft = await a.rpc('create_injectable_draft_v2', {
    p_patient_id: seeded.patientId,
    p_map_type: 'face',
  });
  expect(draft.error).toBeNull();
  const draftRow = Array.isArray(draft.data) ? draft.data[0] : draft.data;
  expect(draftRow?.id).toBeTruthy();
  expect(draftRow?.status).toBe('draft');
  const mapId = draftRow!.id as string;

  const saved = await a.rpc('save_injectable_draft_v2', {
    p_map_id: mapId,
    p_expected_revision: Number(draftRow!.revision),
    p_applications: [{
      service_id: seeded.serviceId,
      product_id: seeded.injectableProductId,
      color: '#be185d',
      dilution_note: 'E2E TEST dilution',
      points: [{
        x: 0.5,
        y: 0.5,
        quantity: 10,
        side: 'center',
        region: 'E2E TEST region',
        note: 'E2E TEST point',
      }],
    }],
  });
  expect(saved.error).toBeNull();
  const savedRow = Array.isArray(saved.data) ? saved.data[0] : saved.data;
  expect(Number(savedRow?.revision)).toBe(Number(draftRow!.revision) + 1);

  const finalizationKey = randomUUID();
  const finalizeArgs = {
    p_map_id: mapId,
    p_expected_revision: Number(savedRow!.revision),
    p_procedure_id: procedureId,
    p_idempotency_key: finalizationKey,
  };
  const [first, second] = await Promise.all([
    a.rpc('finalize_injectable_map_v2', finalizeArgs),
    a.rpc('finalize_injectable_map_v2', finalizeArgs),
  ]);
  expect(first.error).toBeNull();
  expect(second.error).toBeNull();
  const firstRow = Array.isArray(first.data) ? first.data[0] : first.data;
  const secondRow = Array.isArray(second.data) ? second.data[0] : second.data;
  expect(firstRow?.status).toBe('finalized');
  expect(secondRow?.id).toBe(firstRow?.id);
  expect(secondRow?.finalization_key).toBe(finalizationKey);

  const maps = await a.from('injectable_maps').select('id,status,procedure_id,finalization_key,points').eq('id', mapId);
  expect(maps.error).toBeNull();
  expect(maps.data).toHaveLength(1);
  expect(maps.data?.[0]?.procedure_id).toBe(procedureId);
  expect(Array.isArray(maps.data?.[0]?.points)).toBe(true);
  expect(maps.data?.[0]?.points).toHaveLength(1);

  const applications = await a.from('injectable_applications').select('id,procedure_item_id,total_quantity_snapshot').eq('map_id', mapId);
  expect(applications.error).toBeNull();
  expect(applications.data).toHaveLength(1);
  expect(applications.data?.[0]?.procedure_item_id).toBeTruthy();
  expect(Number(applications.data?.[0]?.total_quantity_snapshot)).toBe(10);

  const points = await a.from('injectable_application_points').select('id,quantity').eq('map_id', mapId);
  expect(points.error).toBeNull();
  expect(points.data).toHaveLength(1);
  expect(Number(points.data?.[0]?.quantity)).toBe(10);

  for (const query of [
    b.from('injectable_maps').select('id').eq('id', mapId),
    b.from('injectable_applications').select('id').eq('map_id', mapId),
    b.from('injectable_application_points').select('id').eq('map_id', mapId),
  ]) {
    const result = await query;
    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  }
});
