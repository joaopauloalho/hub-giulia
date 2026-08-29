import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { signedInClient } from './helpers';

type E2EState = { patientId: string };
const readState = async () => JSON.parse(await fs.readFile('.e2e-state.json', 'utf8')) as E2EState;

async function createService(client: Awaited<ReturnType<typeof signedInClient>>, input: { name: string; type: 'servico' | 'combo'; price: number }) {
  const auth = await client.auth.getUser();
  expect(auth.error).toBeNull();
  const userId = auth.data.user?.id;
  expect(userId).toBeTruthy();
  const result = await client.from('services').insert({
    user_id: userId,
    name: input.name,
    type: input.type,
    price: input.price,
    cost_per_unit: 10,
    duration_minutes: 45,
    active: true,
    is_injectable: false,
  }).select('id,name,type,price').single();
  expect(result.error).toBeNull();
  return result.data!;
}

async function registerCoveredSession(client: Awaited<ReturnType<typeof signedInClient>>, patientId: string, serviceId: string, packageItemId: string, finalPrice: number) {
  const result = await client.rpc('create_procedure_v4', {
    p_idempotency_key: randomUUID(),
    p_patient_id: patientId,
    p_appointment_id: null,
    p_performed_at: new Date().toISOString(),
    p_items: [{ service_id: serviceId, qty: 1, final_price: finalPrice }],
    p_payment_entries: [],
    p_injectable_maps: [],
    p_coverages: [{ service_id: serviceId, package_item_id: packageItemId, quantity: 1 }],
    p_materials: [],
    p_notes: 'E2E TEST treatment session',
  });
  expect(result.error).toBeNull();
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  expect(row?.id).toBeTruthy();
  expect(Number(row?.total_value)).toBe(0);
  return row!.id as string;
}

test('configured combo expands into clinical sessions, charges once and survives reversal correctly', async () => {
  const seeded = await readState();
  const a = await signedInClient('a');
  const b = await signedInClient('b');

  const mmp = await createService(a, { name: 'E2E TEST MMP', type: 'servico', price: 100 });
  const peeling = await createService(a, { name: 'E2E TEST Peeling', type: 'servico', price: 100 });
  const combo = await createService(a, { name: 'E2E TEST Combo acne', type: 'combo', price: 300 });

  const composition = await a.rpc('replace_service_combo_items_v1', {
    p_combo_service_id: combo.id,
    p_items: [
      { component_service_id: mmp.id, quantity: 2 },
      { component_service_id: peeling.id, quantity: 1 },
    ],
  });
  expect(composition.error).toBeNull();
  expect(composition.data).toHaveLength(2);

  const crossTenantComposition = await b.from('service_combo_items').select('id').eq('combo_service_id', combo.id);
  expect(crossTenantComposition.error).toBeNull();
  expect(crossTenantComposition.data).toEqual([]);
  const forbiddenReplace = await b.rpc('replace_service_combo_items_v1', {
    p_combo_service_id: combo.id,
    p_items: [{ component_service_id: mmp.id, quantity: 1 }],
  });
  expect(forbiddenReplace.error).not.toBeNull();

  const packageResult = await a.rpc('create_manual_package_v1', {
    p_idempotency_key: randomUUID(),
    p_patient_id: seeded.patientId,
    p_title: 'E2E TEST Protocolo acne',
    p_source_type: 'manual',
    p_items: [{ service_id: combo.id, quantity: 1, commercial_value: 300 }],
    p_valid_from: null,
    p_valid_until: null,
    p_reason: 'E2E TEST combo sale',
    p_notes: 'E2E TEST package',
  });
  expect(packageResult.error).toBeNull();
  const packageRow = Array.isArray(packageResult.data) ? packageResult.data[0] : packageResult.data;
  const packageId = packageRow!.id as string;

  const packageItems = await a.from('patient_package_items')
    .select('id,service_id,service_name_snapshot,quantity_granted,commercial_value_snapshot,source_combo_service_id,source_combo_name_snapshot')
    .eq('package_id', packageId)
    .order('sort_order');
  expect(packageItems.error).toBeNull();
  expect(packageItems.data).toHaveLength(2);
  const mmpItem = packageItems.data!.find(item => item.service_id === mmp.id)!;
  const peelingItem = packageItems.data!.find(item => item.service_id === peeling.id)!;
  expect(Number(mmpItem.quantity_granted)).toBe(2);
  expect(Number(peelingItem.quantity_granted)).toBe(1);
  expect(mmpItem.source_combo_service_id).toBe(combo.id);
  expect(mmpItem.source_combo_name_snapshot).toBe('E2E TEST Combo acne');
  expect(Number(mmpItem.commercial_value_snapshot) + Number(peelingItem.commercial_value_snapshot)).toBeCloseTo(300, 2);

  const activation = await a.rpc('activate_package_v1', { p_package_id: packageId, p_idempotency_key: randomUUID() });
  expect(activation.error).toBeNull();

  const balances = await a.from('patient_credit_item_balances_v').select('package_item_id,service_id,quantity_granted,available_balance').eq('package_id', packageId);
  expect(balances.error).toBeNull();
  expect(Number(balances.data?.find(row => row.service_id === mmp.id)?.available_balance)).toBe(2);

  const firstProcedure = await registerCoveredSession(a, seeded.patientId, mmp.id, mmpItem.id, 100);
  const secondProcedure = await registerCoveredSession(a, seeded.patientId, mmp.id, mmpItem.id, 100);

  const sessionsBeforeReversal = await a.from('procedure_treatment_sessions_v1')
    .select('procedure_id_snapshot,service_id,session_start,session_end,session_total,package_title')
    .eq('package_item_id', mmpItem.id)
    .order('created_at');
  expect(sessionsBeforeReversal.error).toBeNull();
  expect(sessionsBeforeReversal.data).toHaveLength(2);
  expect(Number(sessionsBeforeReversal.data?.[0]?.session_end)).toBe(1);
  expect(Number(sessionsBeforeReversal.data?.[1]?.session_end)).toBe(2);
  expect(Number(sessionsBeforeReversal.data?.[1]?.session_total)).toBe(2);
  expect(sessionsBeforeReversal.data?.[1]?.package_title).toBe('E2E TEST Protocolo acne');

  const payments = await a.from('procedure_payments').select('id,amount').in('procedure_id', [firstProcedure, secondProcedure]);
  expect(payments.error).toBeNull();
  expect(payments.data).toEqual([]);

  const deletion = await a.from('procedures').delete().eq('id', firstProcedure);
  expect(deletion.error).toBeNull();

  const balanceAfterReversal = await a.from('patient_credit_item_balances_v').select('available_balance,redeemed,reversed').eq('package_item_id', mmpItem.id).single();
  expect(balanceAfterReversal.error).toBeNull();
  expect(Number(balanceAfterReversal.data?.available_balance)).toBe(1);
  expect(Number(balanceAfterReversal.data?.redeemed)).toBe(2);
  expect(Number(balanceAfterReversal.data?.reversed)).toBe(1);

  const sessionsAfterReversal = await a.from('procedure_treatment_sessions_v1').select('procedure_id_snapshot,session_end,session_total').eq('package_item_id', mmpItem.id);
  expect(sessionsAfterReversal.error).toBeNull();
  expect(sessionsAfterReversal.data).toHaveLength(1);
  expect(sessionsAfterReversal.data?.[0]?.procedure_id_snapshot).toBe(secondProcedure);
  expect(Number(sessionsAfterReversal.data?.[0]?.session_end)).toBe(1);

  const replacementProcedure = await registerCoveredSession(a, seeded.patientId, mmp.id, mmpItem.id, 100);
  const finalSessions = await a.from('procedure_treatment_sessions_v1').select('procedure_id_snapshot,session_end').eq('package_item_id', mmpItem.id).order('created_at');
  expect(finalSessions.error).toBeNull();
  expect(finalSessions.data).toHaveLength(2);
  expect(Number(finalSessions.data?.[1]?.session_end)).toBe(2);
  expect(finalSessions.data?.[1]?.procedure_id_snapshot).toBe(replacementProcedure);

  const crossTenantSessions = await b.from('procedure_treatment_sessions_v1').select('redemption_id').eq('package_id', packageId);
  expect(crossTenantSessions.error).toBeNull();
  expect(crossTenantSessions.data).toEqual([]);
});
