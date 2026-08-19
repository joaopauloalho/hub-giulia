import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { signedInClient } from './helpers';

test('package fee allocation keeps cumulative residual cents without repeating the sale fee', async () => {
  const client = await signedInClient('a');

  const patient = await client.from('patients').insert({
    name: 'E2E HUB44 Package Rounding',
    phone: '43999994445',
    email: 'hub44-package-rounding@hub-giulia.local',
  }).select('id').single();
  expect(patient.error).toBeNull();

  const service = await client.from('services').insert({
    name: 'FIN44 Package Rounding',
    type: 'servico',
    price: 600,
    cost_per_unit: 100,
    cost_is_configured: true,
    duration_minutes: 30,
    active: true,
    is_injectable: false,
  }).select('id').single();
  expect(service.error).toBeNull();

  const createdPackage = await client.rpc('create_manual_package_v1', {
    p_idempotency_key: randomUUID(),
    p_patient_id: patient.data!.id,
    p_title: 'FIN44 Package Rounding 3x',
    p_source_type: 'manual',
    p_items: [{ service_id: service.data!.id, quantity: 3, commercial_value: 1500 }],
    p_valid_from: '2026-08-01',
    p_valid_until: '2027-08-01',
    p_reason: 'HUB44 package fee rounding fixture',
    p_notes: null,
  });
  expect(createdPackage.error).toBeNull();
  const packageId = (createdPackage.data as { id: string }).id;

  const sale = await client.rpc('record_package_sale_v1', {
    p_package_id: packageId,
    p_idempotency_key: randomUUID(),
    p_payment_entries: [{
      method: 'pix',
      base_amount: 1500,
      amount: 1500,
      card_brand: null,
      installments: 1,
      fee_pct: 10 / 1500 * 100,
      fee_value: 10,
      net_amount: 1490,
      absorve_taxa: true,
      scheduled_date: null,
    }],
  });
  expect(sale.error).toBeNull();

  const activation = await client.rpc('activate_package_v1', {
    p_package_id: packageId,
    p_idempotency_key: randomUUID(),
  });
  expect(activation.error).toBeNull();

  const packageItem = await client
    .from('patient_package_items')
    .select('id')
    .eq('package_id', packageId)
    .single();
  expect(packageItem.error).toBeNull();

  for (const day of [21, 22]) {
    const procedure = await client.rpc('create_procedure_v3', {
      p_idempotency_key: randomUUID(),
      p_patient_id: patient.data!.id,
      p_appointment_id: null,
      p_performed_at: `2026-08-${day}T10:00:00-03:00`,
      p_items: [{ service_id: service.data!.id, qty: 1, final_price: 600 }],
      p_payment_entries: [],
      p_injectable_maps: [],
      p_coverages: [{ service_id: service.data!.id, package_item_id: packageItem.data!.id, quantity: 1 }],
      p_notes: 'HUB44 package fee rounding redemption',
    });
    expect(procedure.error).toBeNull();
  }

  const report = await client.rpc('list_service_financial_performance_v1', {
    p_date_from: '2026-08-01',
    p_date_to: '2026-08-31',
    p_sort_by: 'realized_value',
    p_service_id: service.data!.id,
  });
  expect(report.error).toBeNull();
  expect(report.data).toHaveLength(1);

  const row = report.data![0];
  expect(Number(row.realized_value)).toBe(1000);
  expect(Number(row.attributed_fee_value)).toBe(6.67);
  expect(Number(row.direct_cost_value)).toBe(200);
  expect(Number(row.contribution_value)).toBe(793.33);

  const detail = await client.rpc('get_service_financial_detail_v1', {
    p_date_from: '2026-08-01',
    p_date_to: '2026-08-31',
    p_service_id: service.data!.id,
    p_limit: 20,
    p_offset: 0,
  });
  expect(detail.error).toBeNull();
  const feeParts = (detail.data ?? []).map((item: { attributed_fee_value: number | string }) => Number(item.attributed_fee_value));
  expect(feeParts.reduce((sum: number, value: number) => sum + value, 0)).toBeCloseTo(6.67, 2);
  expect(feeParts.sort((a: number, b: number) => a - b)).toEqual([3.33, 3.34]);
});
