import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { adminClient, anonClient, signedInClient } from './helpers';

type E2EState = {
  users: { a: string; b: string };
  serviceId: string;
  patientId: string;
};

async function state(): Promise<E2EState> {
  return JSON.parse(await fs.readFile('.e2e-state.json', 'utf8')) as E2EState;
}

function foreignAttendanceArgs(seeded: E2EState) {
  return {
    p_idempotency_key: randomUUID(),
    p_patient_id: seeded.patientId,
    p_appointment_id: null,
    p_performed_at: '2030-02-01T13:00:00.000Z',
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
    p_coverages: [],
    p_notes: 'HUB44 negative SECURITY DEFINER test',
  };
}

test('create_procedure_v3 SECURITY DEFINER rejects cross-tenant references without side effects', async () => {
  const seeded = await state();
  const tenantB = await signedInClient('b');
  const args = foreignAttendanceArgs(seeded);

  const attempt = await tenantB.rpc('create_procedure_v3', args);
  expect(attempt.error).not.toBeNull();

  const leakedProcedure = await adminClient()
    .from('procedures')
    .select('id,user_id')
    .eq('idempotency_key', args.p_idempotency_key);
  expect(leakedProcedure.error).toBeNull();
  expect(leakedProcedure.data).toEqual([]);
});

test('anon cannot execute elevated create_procedure_v3', async () => {
  const seeded = await state();
  const attempt = await anonClient().rpc('create_procedure_v3', foreignAttendanceArgs(seeded));
  expect(attempt.error).not.toBeNull();
});
