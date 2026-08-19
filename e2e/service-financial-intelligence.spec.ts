import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { browserLogin, signedInClient } from './helpers';

const AUG_FROM = '2026-08-01';
const AUG_TO = '2026-08-31';

type Client = Awaited<ReturnType<typeof signedInClient>>;

async function createService(client: Client, input: { name: string; price: number; cost: number; costKnown: boolean; duration: number | null }) {
  const { data, error } = await client.from('services').insert({
    name: input.name,
    type: 'servico',
    price: input.price,
    cost_per_unit: input.cost,
    cost_is_configured: input.costKnown,
    duration_minutes: input.duration,
    active: true,
    is_injectable: false,
  }).select('id').single();
  expect(error, `create service ${input.name}`).toBeNull();
  return data!.id as string;
}

function payment(base: number, fee: number) {
  return [{
    method: 'pix',
    base_amount: base,
    amount: base,
    card_brand: null,
    installments: 1,
    fee_pct: base > 0 ? fee / base * 100 : 0,
    fee_value: fee,
    net_amount: base - fee,
    absorve_taxa: true,
    scheduled_date: null,
  }];
}

async function createProcedure(client: Client, args: {
  patientId: string;
  performedAt: string;
  items: Array<{ service_id: string; qty: number; final_price: number }>;
  payments: ReturnType<typeof payment>;
  coverages?: Array<{ service_id: string; package_item_id: string; quantity: number }>;
  appointmentId?: string | null;
}) {
  const { data, error } = await client.rpc('create_procedure_v3', {
    p_idempotency_key: randomUUID(),
    p_patient_id: args.patientId,
    p_appointment_id: args.appointmentId ?? null,
    p_performed_at: args.performedAt,
    p_items: args.items,
    p_payment_entries: args.payments,
    p_injectable_maps: [],
    p_coverages: args.coverages ?? [],
    p_notes: 'HUB44 isolated financial fixture',
  });
  expect(error, `create procedure ${args.performedAt}`).toBeNull();
  return data as { id: string };
}

function byService(rows: Array<Record<string, unknown>>, id: string) {
  const row = rows.find(item => item.service_id === id);
  expect(row, `service ${id} present in read model`).toBeTruthy();
  return row!;
}

function n(row: Record<string, unknown>, key: string) {
  return Number(row[key] ?? 0);
}

let fixture: {
  patientId: string;
  botoxId: string;
  peelingId: string;
  unknownCostId: string;
  zeroCostId: string;
  packageServiceId: string;
  roundIds: string[];
};

test.describe.serial('Hub Giulia 4.4 service financial intelligence', () => {
  test.beforeAll(async () => {
    const client = await signedInClient('a');
    const { data: patient, error: patientError } = await client.from('patients').insert({
      name: 'E2E HUB44 Financial Patient',
      phone: '43999994444',
      email: 'hub44-finance@hub-giulia.local',
    }).select('id').single();
    expect(patientError).toBeNull();

    const botoxId = await createService(client, { name: 'FIN44 Botox', price: 1000, cost: 300, costKnown: true, duration: 30 });
    const peelingId = await createService(client, { name: 'FIN44 Peeling', price: 250, cost: 50, costKnown: true, duration: 60 });
    const unknownCostId = await createService(client, { name: 'FIN44 Unknown Cost', price: 100, cost: 0, costKnown: false, duration: 30 });
    const zeroCostId = await createService(client, { name: 'FIN44 Known Zero Cost', price: 100, cost: 0, costKnown: true, duration: null });
    const packageServiceId = await createService(client, { name: 'FIN44 Package Service', price: 600, cost: 100, costKnown: true, duration: 30 });
    const roundA = await createService(client, { name: 'FIN44 Round A', price: 333.33, cost: 0, costKnown: true, duration: 30 });
    const roundB = await createService(client, { name: 'FIN44 Round B', price: 333.33, cost: 0, costKnown: true, duration: 30 });
    const roundC = await createService(client, { name: 'FIN44 Round C', price: 333.34, cost: 0, costKnown: true, duration: 30 });

    await createProcedure(client, {
      patientId: patient!.id,
      performedAt: '2026-08-10T10:00:00-03:00',
      items: [{ service_id: botoxId, qty: 1, final_price: 900 }],
      payments: payment(900, 30),
    });

    await createProcedure(client, {
      patientId: patient!.id,
      performedAt: '2026-08-11T10:00:00-03:00',
      items: [
        { service_id: botoxId, qty: 1, final_price: 800 },
        { service_id: peelingId, qty: 1, final_price: 200 },
      ],
      payments: payment(1000, 50),
    });

    await createProcedure(client, {
      patientId: patient!.id,
      performedAt: '2026-08-12T10:00:00-03:00',
      items: [{ service_id: unknownCostId, qty: 1, final_price: 100 }],
      payments: payment(100, 0),
    });

    await createProcedure(client, {
      patientId: patient!.id,
      performedAt: '2026-08-13T10:00:00-03:00',
      items: [{ service_id: zeroCostId, qty: 1, final_price: 100 }],
      payments: payment(100, 0),
    });

    // Package: R$1,500 for 3 sessions, R$30 sale fee. Two redemptions must realize
    // R$500 and R$10 fee each — never R$1,500/R$30 per session.
    const { data: pkg, error: packageError } = await client.rpc('create_manual_package_v1', {
      p_idempotency_key: randomUUID(),
      p_patient_id: patient!.id,
      p_title: 'FIN44 Package 3x',
      p_source_type: 'manual',
      p_items: [{ service_id: packageServiceId, quantity: 3, commercial_value: 1500 }],
      p_valid_from: '2026-08-01',
      p_valid_until: '2027-08-01',
      p_reason: 'HUB44 E2E package valuation',
      p_notes: null,
    });
    expect(packageError).toBeNull();
    const packageId = (pkg as { id: string }).id;

    const sale = await client.rpc('record_package_sale_v1', {
      p_package_id: packageId,
      p_idempotency_key: randomUUID(),
      p_payment_entries: payment(1500, 30),
    });
    expect(sale.error).toBeNull();
    const activation = await client.rpc('activate_package_v1', { p_package_id: packageId, p_idempotency_key: randomUUID() });
    expect(activation.error).toBeNull();

    const { data: packageItem, error: packageItemError } = await client.from('patient_package_items').select('id').eq('package_id', packageId).single();
    expect(packageItemError).toBeNull();

    for (const day of [14, 15]) {
      await createProcedure(client, {
        patientId: patient!.id,
        performedAt: `2026-08-${day}T10:00:00-03:00`,
        items: [{ service_id: packageServiceId, qty: 1, final_price: 600 }],
        payments: [],
        coverages: [{ service_id: packageServiceId, package_item_id: packageItem!.id, quantity: 1 }],
      });
    }

    await createProcedure(client, {
      patientId: patient!.id,
      performedAt: '2026-08-16T10:00:00-03:00',
      items: [
        { service_id: roundA, qty: 1, final_price: 333.33 },
        { service_id: roundB, qty: 1, final_price: 333.33 },
        { service_id: roundC, qty: 1, final_price: 333.34 },
      ],
      payments: payment(1000, 10),
    });

    // Sao Paulo boundary: first belongs to August, second belongs to September.
    await createProcedure(client, {
      patientId: patient!.id,
      performedAt: '2026-08-31T23:30:00-03:00',
      items: [{ service_id: peelingId, qty: 1, final_price: 200 }],
      payments: payment(200, 0),
    });
    await createProcedure(client, {
      patientId: patient!.id,
      performedAt: '2026-09-01T00:30:00-03:00',
      items: [{ service_id: peelingId, qty: 1, final_price: 200 }],
      payments: payment(200, 0),
    });

    // Current catalog changes must not rewrite historical price, cost or duration.
    const update = await client.from('services').update({ name: 'FIN44 Botox Renamed', price: 1200, cost_per_unit: 500, duration_minutes: 45, active: false }).eq('id', botoxId);
    expect(update.error).toBeNull();

    fixture = {
      patientId: patient!.id,
      botoxId,
      peelingId,
      unknownCostId,
      zeroCostId,
      packageServiceId,
      roundIds: [roundA, roundB, roundC],
    };
  });

  test('reconciles historical value, discounts, cost snapshots, fee allocation, packages and coverage', async () => {
    const client = await signedInClient('a');
    const list = await client.rpc('list_service_financial_performance_v1', {
      p_date_from: AUG_FROM,
      p_date_to: AUG_TO,
      p_sort_by: 'realized_value',
      p_service_id: null,
    });
    expect(list.error).toBeNull();
    const rows = (list.data ?? []) as Array<Record<string, unknown>>;

    const botox = byService(rows, fixture.botoxId);
    expect(botox.service_name).toBe('FIN44 Botox Renamed');
    expect(botox.is_archived).toBe(true);
    expect(n(botox, 'realizations')).toBe(2);
    expect(n(botox, 'table_value')).toBe(2000);
    expect(n(botox, 'realized_value')).toBe(1700);
    expect(n(botox, 'discount_value')).toBe(300);
    expect(n(botox, 'direct_cost_value')).toBe(600);
    expect(n(botox, 'attributed_fee_value')).toBe(70);
    expect(n(botox, 'contribution_value')).toBe(1030);
    expect(n(botox, 'duration_minutes')).toBe(60);
    expect(n(botox, 'contribution_per_hour')).toBe(1030);

    const peeling = byService(rows, fixture.peelingId);
    expect(n(peeling, 'realizations')).toBe(2); // Sept 1 local is excluded from August.
    expect(n(peeling, 'attributed_fee_value')).toBe(10);

    const unknown = byService(rows, fixture.unknownCostId);
    expect(n(unknown, 'cost_coverage_pct')).toBe(0);
    expect(n(unknown, 'contribution_coverage_pct')).toBe(0);
    expect(n(unknown, 'contribution_value')).toBe(0);

    const knownZero = byService(rows, fixture.zeroCostId);
    expect(n(knownZero, 'cost_coverage_pct')).toBe(100);
    expect(n(knownZero, 'contribution_value')).toBe(100);
    expect(knownZero.contribution_per_hour).toBeNull();

    const packageRow = byService(rows, fixture.packageServiceId);
    expect(n(packageRow, 'package_realizations')).toBe(2);
    expect(n(packageRow, 'realized_value')).toBe(1000);
    expect(n(packageRow, 'discount_value')).toBe(200);
    expect(n(packageRow, 'direct_cost_value')).toBe(200);
    expect(n(packageRow, 'attributed_fee_value')).toBe(20);
    expect(n(packageRow, 'contribution_value')).toBe(780);

    const roundDetails = await Promise.all(fixture.roundIds.map(async id => {
      const detail = await client.rpc('get_service_financial_detail_v1', { p_date_from: AUG_FROM, p_date_to: AUG_TO, p_service_id: id, p_limit: 20, p_offset: 0 });
      expect(detail.error).toBeNull();
      return Number((detail.data?.[0] as Record<string, unknown>).attributed_fee_value);
    }));
    expect(roundDetails.reduce((sum, value) => sum + value, 0)).toBeCloseTo(10, 2);
    expect(roundDetails.sort((a, b) => a - b)).toEqual([3.33, 3.33, 3.34]);

    const summary = await client.rpc('get_service_financial_summary_v1', { p_date_from: AUG_FROM, p_date_to: AUG_TO });
    expect(summary.error).toBeNull();
    const total = summary.data?.[0] as Record<string, unknown>;
    for (const key of ['realized_value', 'discount_value', 'direct_cost_value', 'attributed_fee_value', 'contribution_value']) {
      const rowSum = rows.reduce((sum, row) => sum + n(row, key), 0);
      expect(n(total, key), `${key} summary equals service rows`).toBeCloseTo(rowSum, 2);
    }
  });

  test('allocates the multi-service procedure fee 40/10 without duplicating it', async () => {
    const client = await signedInClient('a');
    const botoxDetail = await client.rpc('get_service_financial_detail_v1', { p_date_from: '2026-08-11', p_date_to: '2026-08-11', p_service_id: fixture.botoxId, p_limit: 20, p_offset: 0 });
    const peelingDetail = await client.rpc('get_service_financial_detail_v1', { p_date_from: '2026-08-11', p_date_to: '2026-08-11', p_service_id: fixture.peelingId, p_limit: 20, p_offset: 0 });
    expect(botoxDetail.error).toBeNull();
    expect(peelingDetail.error).toBeNull();
    expect(Number(botoxDetail.data?.[0]?.attributed_fee_value)).toBe(40);
    expect(Number(peelingDetail.data?.[0]?.attributed_fee_value)).toBe(10);
  });

  test('blocks anon and cross-tenant reads', async () => {
    const tenantB = await signedInClient('b');
    const bSummary = await tenantB.rpc('get_service_financial_summary_v1', { p_date_from: AUG_FROM, p_date_to: AUG_TO });
    expect(bSummary.error).toBeNull();
    expect(Number(bSummary.data?.[0]?.realizations)).toBe(0);
    const bList = await tenantB.rpc('list_service_financial_performance_v1', { p_date_from: AUG_FROM, p_date_to: AUG_TO, p_sort_by: 'realized_value', p_service_id: null });
    expect(bList.error).toBeNull();
    expect(bList.data).toEqual([]);

    const { anonClient } = await import('./helpers');
    const anon = anonClient();
    const anonSummary = await anon.rpc('get_service_financial_summary_v1', { p_date_from: AUG_FROM, p_date_to: AUG_TO });
    expect(anonSummary.error).not.toBeNull();
  });

  test('does not create realized financial rows for a canceled appointment', async () => {
    const client = await signedInClient('a');
    const { data: appointment, error: appointmentError } = await client.from('appointments').insert({
      patient_id: fixture.patientId,
      service_id: fixture.zeroCostId,
      scheduled_at: '2026-08-20T10:00:00-03:00',
      duration_minutes: 30,
      end_at: '2026-08-20T10:30:00-03:00',
      status: 'cancelado',
    }).select('id').single();
    expect(appointmentError).toBeNull();
    const result = await client.rpc('create_procedure_v3', {
      p_idempotency_key: randomUUID(),
      p_patient_id: fixture.patientId,
      p_appointment_id: appointment!.id,
      p_performed_at: '2026-08-20T10:00:00-03:00',
      p_items: [{ service_id: fixture.zeroCostId, qty: 1, final_price: 100 }],
      p_payment_entries: payment(100, 0),
      p_injectable_maps: [],
      p_coverages: [],
      p_notes: 'must fail',
    });
    expect(result.error).not.toBeNull();
  });

  test('renders the service tab, filters periods, opens drilldown and stays responsive on iPad/mobile', async ({ page }) => {
    await browserLogin(page, 'a');
    await page.goto('/financeiro');
    await page.getByRole('tab', { name: 'Por serviço' }).click();
    await expect(page.getByTestId('service-financial-page')).toBeVisible();
    await page.getByRole('button', { name: 'Personalizado' }).click();
    const dates = page.locator('.sf-custom-period input[type="date"]');
    await dates.nth(0).fill(AUG_FROM);
    await dates.nth(1).fill(AUG_TO);
    await expect(page.getByText('FIN44 Botox Renamed')).toBeVisible();
    await expect(page.getByText('Contribuição direta não representa o lucro líquido da clínica.')).toBeVisible();

    await page.getByRole('button', { name: /FIN44 Botox Renamed/ }).click();
    await expect(page.getByRole('dialog')).toContainText('E2E HUB44 Financial Patient');
    await page.getByRole('button', { name: 'Fechar detalhes' }).click();

    for (const viewport of [{ width: 1024, height: 768 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      expect(hasHorizontalOverflow, `${viewport.width}x${viewport.height} horizontal overflow`).toBe(false);
    }

    await dates.nth(0).fill('2026-09-01');
    await dates.nth(1).fill('2026-09-30');
    await expect(page.getByText('FIN44 Peeling')).toBeVisible();
    await expect(page.getByText('FIN44 Botox Renamed')).toHaveCount(0);
  });
});
