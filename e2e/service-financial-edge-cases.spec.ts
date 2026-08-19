import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { adminClient, browserLogin, signedInClient } from './helpers';

type E2EState = { users: { a: string; b: string } };

async function state(): Promise<E2EState> {
  return JSON.parse(await fs.readFile('.e2e-state.json', 'utf8')) as E2EState;
}

function zeroFeePayment(amount: number) {
  return [{
    method: 'pix',
    base_amount: amount,
    amount,
    card_brand: null,
    installments: 1,
    fee_pct: 0,
    fee_value: 0,
    net_amount: amount,
    absorve_taxa: false,
    scheduled_date: null,
  }];
}

test('unit cost is multiplied by qty exactly once and duration is not multiplied by qty', async () => {
  const client = await signedInClient('a');
  const patient = await client.from('patients').insert({
    name: 'E2E HUB44 Quantity Patient',
    phone: '43999994446',
    email: 'hub44-quantity@hub-giulia.local',
  }).select('id').single();
  expect(patient.error).toBeNull();

  const service = await client.from('services').insert({
    name: 'FIN44 Quantity Cost',
    type: 'servico',
    price: 200,
    cost_per_unit: 100,
    cost_is_configured: true,
    duration_minutes: 30,
    active: true,
    is_injectable: false,
  }).select('id').single();
  expect(service.error).toBeNull();

  const procedure = await client.rpc('create_procedure_v3', {
    p_idempotency_key: randomUUID(),
    p_patient_id: patient.data!.id,
    p_appointment_id: null,
    p_performed_at: '2026-08-23T10:00:00-03:00',
    p_items: [{ service_id: service.data!.id, qty: 2, final_price: 400 }],
    p_payment_entries: zeroFeePayment(400),
    p_injectable_maps: [],
    p_coverages: [],
    p_notes: 'HUB44 qty double multiplication guard',
  });
  expect(procedure.error).toBeNull();

  const report = await client.rpc('list_service_financial_performance_v1', {
    p_date_from: '2026-08-23',
    p_date_to: '2026-08-23',
    p_sort_by: 'realized_value',
    p_service_id: service.data!.id,
  });
  expect(report.error).toBeNull();
  expect(report.data).toHaveLength(1);
  const row = report.data![0];
  expect(Number(row.table_value)).toBe(400);
  expect(Number(row.realized_value)).toBe(400);
  expect(Number(row.direct_cost_value)).toBe(200);
  expect(Number(row.contribution_value)).toBe(200);
  expect(Number(row.duration_minutes)).toBe(30);
  expect(Number(row.contribution_per_hour)).toBe(400);
});

test('voucher redemption stays visible but unvalued instead of inventing economic value', async () => {
  const seeded = await state();
  const client = await signedInClient('a');
  const admin = adminClient();

  const patient = await client.from('patients').insert({
    name: 'E2E HUB44 Voucher Patient',
    phone: '43999994447',
    email: 'hub44-voucher@hub-giulia.local',
  }).select('id').single();
  expect(patient.error).toBeNull();

  const service = await client.from('services').insert({
    name: 'FIN44 Voucher Service',
    type: 'servico',
    price: 600,
    cost_per_unit: 100,
    cost_is_configured: true,
    duration_minutes: 30,
    active: true,
    is_injectable: false,
  }).select('id,name').single();
  expect(service.error).toBeNull();

  const packageRow = await admin.from('patient_packages').insert({
    user_id: seeded.users.a,
    patient_id: patient.data!.id,
    title_snapshot: 'FIN44 Voucher',
    source_type: 'voucher',
    status: 'active',
    commercial_total_snapshot: 600,
    valid_from: '2026-08-01',
    valid_until: '2027-08-01',
    activated_at: '2026-08-01T10:00:00Z',
    creation_reason: 'HUB44 isolated voucher fixture',
    creation_idempotency_key: randomUUID(),
    created_by: seeded.users.a,
  }).select('id').single();
  expect(packageRow.error).toBeNull();

  const packageItem = await admin.from('patient_package_items').insert({
    user_id: seeded.users.a,
    package_id: packageRow.data!.id,
    service_id: service.data!.id,
    service_name_snapshot: service.data!.name,
    quantity_granted: 1,
    unit_label_snapshot: 'sessão',
    commercial_value_snapshot: 600,
  }).select('id').single();
  expect(packageItem.error).toBeNull();

  const procedure = await admin.from('procedures').insert({
    user_id: seeded.users.a,
    patient_id: patient.data!.id,
    performed_at: '2026-08-24T10:00:00-03:00',
    services_ids: [],
    total_value: 0,
    total_cost: 100,
    payment_method: 'package_credit',
    net_value: 0,
    paid_amount: 0,
    paid_fee_value: 0,
    paid_net_value: 0,
    pending_amount: 0,
    item_names_snapshot: [],
    gross_value: 600,
    covered_value: 600,
  }).select('id').single();
  expect(procedure.error).toBeNull();

  const item = await admin.from('procedure_items').insert({
    user_id: seeded.users.a,
    procedure_id: procedure.data!.id,
    service_id: service.data!.id,
    name: service.data!.name,
    qty: 1,
    list_price: 600,
    final_price: 600,
    discount: 0,
    cost_snapshot: 100,
    coverage_value_snapshot: 600,
    amount_due_snapshot: 0,
    cost_snapshot_known: true,
    duration_minutes_snapshot: 30,
  }).select('id').single();
  expect(item.error).toBeNull();

  const ledger = await admin.from('patient_credit_ledger').insert({
    user_id: seeded.users.a,
    patient_id: patient.data!.id,
    package_id: packageRow.data!.id,
    package_item_id: packageItem.data!.id,
    movement_type: 'redeem',
    quantity_delta: -1,
    source_type: 'procedure',
    source_id: procedure.data!.id,
    procedure_id: procedure.data!.id,
    procedure_item_id: item.data!.id,
    procedure_id_snapshot: procedure.data!.id,
    procedure_item_id_snapshot: item.data!.id,
    reason: 'HUB44 isolated voucher redemption',
    idempotency_key: `hub44-voucher:${procedure.data!.id}`,
    created_by: seeded.users.a,
  }).select('id').single();
  expect(ledger.error).toBeNull();

  const redemption = await admin.from('package_redemptions').insert({
    user_id: seeded.users.a,
    patient_id: patient.data!.id,
    package_id: packageRow.data!.id,
    package_item_id: packageItem.data!.id,
    procedure_id: procedure.data!.id,
    procedure_item_id: item.data!.id,
    procedure_id_snapshot: procedure.data!.id,
    procedure_item_id_snapshot: item.data!.id,
    quantity: 1,
    coverage_value_snapshot: 600,
    ledger_movement_id: ledger.data!.id,
    idempotency_key: `hub44-voucher:${procedure.data!.id}`,
  });
  expect(redemption.error).toBeNull();

  const report = await client.rpc('list_service_financial_performance_v1', {
    p_date_from: '2026-08-24',
    p_date_to: '2026-08-24',
    p_sort_by: 'realized_value',
    p_service_id: service.data!.id,
  });
  expect(report.error).toBeNull();
  expect(report.data).toHaveLength(1);
  const row = report.data![0];
  expect(Number(row.realizations)).toBe(1);
  expect(Number(row.package_realizations)).toBe(1);
  expect(Number(row.unvalued_package_realizations)).toBe(1);
  expect(Number(row.valuation_coverage_pct)).toBe(0);
  expect(Number(row.contribution_coverage_pct)).toBe(0);
  expect(Number(row.realized_value)).toBe(0);
  expect(Number(row.contribution_value)).toBe(0);
});

test('Financeiro Por serviço has no page-level horizontal overflow at all required target viewports', async ({ page }) => {
  await browserLogin(page, 'a');
  await page.goto('/financeiro');
  await page.getByRole('tab', { name: 'Por serviço' }).click();
  await expect(page.getByTestId('service-financial-page')).toBeVisible();

  const viewports = [
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1180, height: 820 },
    { width: 1366, height: 1024 },
    { width: 1440, height: 900 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(hasHorizontalOverflow, `${viewport.width}x${viewport.height} horizontal overflow`).toBe(false);
  }
});
