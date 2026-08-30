import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { signedInClient } from './helpers';

type E2EState = { serviceId: string; patientId: string };
const readState = async () => JSON.parse(await fs.readFile('.e2e-state.json', 'utf8')) as E2EState;

function saoPauloDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

test('clinical time cost is owner-scoped, snapshotted and idempotent', async () => {
  const seeded = await readState();
  const a = await signedInClient('a');
  const b = await signedInClient('b');

  const config = await a.from('clinic_cost_settings').upsert({ hourly_rate: 120 }).select('user_id,hourly_rate').single();
  expect(config.error).toBeNull();
  expect(config.data?.user_id).toBeTruthy();
  expect(Number(config.data?.hourly_rate)).toBe(120);

  const hiddenFromOtherTenant = await b.from('clinic_cost_settings').select('hourly_rate');
  expect(hiddenFromOtherTenant.error).toBeNull();
  expect(hiddenFromOtherTenant.data).toEqual([]);

  const idempotencyKey = randomUUID();
  const payload = {
    p_idempotency_key: idempotencyKey,
    p_patient_id: seeded.patientId,
    p_appointment_id: null,
    p_performed_at: `${saoPauloDate()}T15:00:00-03:00`,
    p_items: [{ service_id: seeded.serviceId, qty: 1, final_price: 0 }],
    p_payment_entries: [],
    p_injectable_maps: [],
    p_coverages: [],
    p_materials: [],
    p_clinical_minutes: 30,
    p_notes: 'E2E TEST clinical time cost',
  };

  const created = await a.rpc('create_procedure_v5', payload);
  expect(created.error).toBeNull();
  const procedure = Array.isArray(created.data) ? created.data[0] : created.data;
  expect(procedure?.id).toBeTruthy();
  expect(Number(procedure?.clinical_minutes)).toBe(30);
  expect(Number(procedure?.clinical_hourly_rate_snapshot)).toBe(120);
  expect(Number(procedure?.clinical_time_cost)).toBe(60);
  expect(procedure?.clinical_cost_applied).toBe(true);
  expect(Number(procedure?.total_cost)).toBeGreaterThanOrEqual(60);

  const changedConfig = await a.from('clinic_cost_settings')
    .update({ hourly_rate: 200 })
    .eq('user_id', config.data!.user_id)
    .select('hourly_rate')
    .single();
  expect(changedConfig.error).toBeNull();
  expect(Number(changedConfig.data?.hourly_rate)).toBe(200);

  const repeated = await a.rpc('create_procedure_v5', payload);
  expect(repeated.error).toBeNull();
  const repeatedProcedure = Array.isArray(repeated.data) ? repeated.data[0] : repeated.data;
  expect(repeatedProcedure?.id).toBe(procedure?.id);
  expect(Number(repeatedProcedure?.clinical_hourly_rate_snapshot)).toBe(120);
  expect(Number(repeatedProcedure?.clinical_time_cost)).toBe(60);

  const conflicting = await a.rpc('create_procedure_v5', { ...payload, p_clinical_minutes: 45 });
  expect(conflicting.error).not.toBeNull();
  expect(String(conflicting.error?.message ?? '')).toContain('ATTENDANCE_IDEMPOTENCY_CONFLICT');

  const persisted = await a.from('procedures')
    .select('clinical_minutes,clinical_hourly_rate_snapshot,clinical_time_cost,total_cost')
    .eq('id', procedure!.id)
    .single();
  expect(persisted.error).toBeNull();
  expect(Number(persisted.data?.clinical_minutes)).toBe(30);
  expect(Number(persisted.data?.clinical_hourly_rate_snapshot)).toBe(120);
  expect(Number(persisted.data?.clinical_time_cost)).toBe(60);

  const foreignProcedure = await b.from('procedures').select('id').eq('id', procedure!.id);
  expect(foreignProcedure.error).toBeNull();
  expect(foreignProcedure.data).toEqual([]);
});
