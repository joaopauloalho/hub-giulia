import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { browserLogin, signedInClient } from './helpers';

type E2EState = { serviceId: string; patientId: string };
const readState = async () => JSON.parse(await fs.readFile('.e2e-state.json', 'utf8')) as E2EState;

function saoPauloDatePlus(days: number) {
  const date = new Date(Date.now() + days * 86_400_000);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

test('attendance supports server draft, discount, future receivable, receipt and courtesy without cross-tenant leakage', async () => {
  const seeded = await readState();
  const a = await signedInClient('a');
  const b = await signedInClient('b');
  const yesterday = saoPauloDatePlus(-1);
  const future = saoPauloDatePlus(3);

  const draftPayload = {
    performedDate: yesterday,
    notes: 'E2E TEST draft',
    serviceIds: [seeded.serviceId],
    finalPriceByService: { [seeded.serviceId]: 80 },
    paymentTiming: 'later',
  };
  const draftWrite = await a.from('attendance_drafts').upsert({
    patient_id: seeded.patientId,
    payload: draftPayload,
  }, { onConflict: 'user_id,patient_id' }).select('id,patient_id,payload').single();
  expect(draftWrite.error).toBeNull();
  expect(draftWrite.data?.patient_id).toBe(seeded.patientId);
  expect(draftWrite.data?.payload).toMatchObject({ paymentTiming: 'later' });

  const draftCrossTenant = await b.from('attendance_drafts').select('id').eq('patient_id', seeded.patientId);
  expect(draftCrossTenant.error).toBeNull();
  expect(draftCrossTenant.data).toEqual([]);

  const discounted = await a.rpc('create_procedure_v4', {
    p_idempotency_key: randomUUID(),
    p_patient_id: seeded.patientId,
    p_appointment_id: null,
    p_performed_at: `${yesterday}T15:00:00-03:00`,
    p_items: [{ service_id: seeded.serviceId, qty: 1, final_price: 80 }],
    p_payment_entries: [{
      method: 'pix',
      base_amount: 80,
      amount: 80,
      card_brand: null,
      installments: 1,
      fee_pct: null,
      fee_value: null,
      net_amount: 80,
      absorve_taxa: true,
      scheduled_date: future,
    }],
    p_injectable_maps: [],
    p_coverages: [],
    p_materials: [],
    p_notes: 'E2E TEST discounted receivable',
  });
  expect(discounted.error).toBeNull();
  const procedure = Array.isArray(discounted.data) ? discounted.data[0] : discounted.data;
  expect(procedure?.id).toBeTruthy();
  expect(Number(procedure?.total_value)).toBe(80);
  expect(Number(procedure?.paid_amount)).toBe(0);
  expect(Number(procedure?.pending_amount)).toBe(80);
  expect(String(procedure?.performed_at).slice(0, 10)).toBe(yesterday);

  const items = await a.from('procedure_items').select('list_price,final_price,discount,amount_due_snapshot').eq('procedure_id', procedure!.id).single();
  expect(items.error).toBeNull();
  expect(Number(items.data?.final_price)).toBe(80);
  expect(Number(items.data?.amount_due_snapshot)).toBe(80);
  expect(Number(items.data?.discount)).toBeGreaterThanOrEqual(0);

  const pending = await a.from('procedure_payments').select('id,amount,scheduled_date,paid_at').eq('procedure_id', procedure!.id).single();
  expect(pending.error).toBeNull();
  expect(Number(pending.data?.amount)).toBe(80);
  expect(pending.data?.scheduled_date).toBe(future);
  expect(pending.data?.paid_at).toBeNull();

  const pay = await a.from('procedure_payments').update({ paid_at: new Date().toISOString() }).eq('id', pending.data!.id).is('paid_at', null).select('id,paid_at').single();
  expect(pay.error).toBeNull();
  expect(pay.data?.paid_at).toBeTruthy();

  const settled = await a.from('procedures').select('paid_amount,pending_amount').eq('id', procedure!.id).single();
  expect(settled.error).toBeNull();
  expect(Number(settled.data?.paid_amount)).toBe(80);
  expect(Number(settled.data?.pending_amount)).toBe(0);

  const courtesy = await a.rpc('create_procedure_v4', {
    p_idempotency_key: randomUUID(),
    p_patient_id: seeded.patientId,
    p_appointment_id: null,
    p_performed_at: `${saoPauloDatePlus(0)}T15:00:00-03:00`,
    p_items: [{ service_id: seeded.serviceId, qty: 1, final_price: 0 }],
    p_payment_entries: [],
    p_injectable_maps: [],
    p_coverages: [],
    p_materials: [],
    p_notes: 'E2E TEST Brinde/cortesia',
  });
  expect(courtesy.error).toBeNull();
  const courtesyProcedure = Array.isArray(courtesy.data) ? courtesy.data[0] : courtesy.data;
  expect(courtesyProcedure?.payment_method).toBe('cortesia');
  expect(Number(courtesyProcedure?.total_value)).toBe(0);
  const courtesyPayments = await a.from('procedure_payments').select('id').eq('procedure_id', courtesyProcedure!.id);
  expect(courtesyPayments.error).toBeNull();
  expect(courtesyPayments.data).toEqual([]);

  const foreignProcedures = await b.from('procedures').select('id').in('id', [procedure!.id, courtesyProcedure!.id]);
  expect(foreignProcedures.error).toBeNull();
  expect(foreignProcedures.data).toEqual([]);

  const deleteDraft = await a.from('attendance_drafts').delete().eq('patient_id', seeded.patientId);
  expect(deleteDraft.error).toBeNull();
});

test('editing the procedure discount after visiting finance recalculates the payment allocation', async ({ page }) => {
  const seeded = await readState();
  await browserLogin(page, 'a');
  await page.goto(`/registrar?patient_id=${seeded.patientId}&service_id=${seeded.serviceId}`);

  const continueButton = page.getByRole('button', { name: /Continuar/ });
  await expect(page.getByText('Valor realizado')).toBeVisible();
  await expect(page.locator('input[type="number"]').first()).toHaveValue('100');

  await continueButton.click();
  await expect(page.getByRole('dialog', { name: 'Mapa de Injetáveis' })).toBeVisible();
  await page.getByRole('button', { name: 'Pular mapa' }).click();
  await expect(page.getByText('Materiais utilizados')).toBeVisible();
  await continueButton.click();

  await expect(page.getByText('Total do atendimento após descontos')).toBeVisible();
  await expect(page.getByText('✓ Valor alocado')).toBeVisible();
  await expect(page.getByText('R$ 100,00')).toBeVisible();

  await page.getByRole('button', { name: 'Alterar valor / desconto' }).click();
  const finalPrice = page.locator('input[type="number"]').first();
  await finalPrice.fill('80');
  await expect(page.getByText(/desconto R\$\s*20,00/)).toBeVisible();

  await continueButton.click();
  await expect(page.getByText('Materiais utilizados')).toBeVisible();
  await continueButton.click();

  await expect(page.getByText('Total do atendimento após descontos')).toBeVisible();
  await expect(page.getByText('✓ Valor alocado')).toBeVisible();
  await expect(page.getByText(/Falta R\$/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Continuar/ })).toBeEnabled();
  await expect(page.getByText('R$ 80,00')).toBeVisible();
});
