import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { browserLogin, signedInClient } from './helpers';

type E2EState = { dealId: string; serviceId: string; patientId: string };
const readState = async () => JSON.parse(await fs.readFile('.e2e-state.json', 'utf8')) as E2EState;

test('CRM stays clean while proposals live in the patient profile and finance stays financial', async ({ page }) => {
  const seeded = await readState();
  const a = await signedInClient('a');

  const resetDeal = await a.from('deals').update({ stage: 'new', value: 100 }).eq('id', seeded.dealId);
  expect(resetDeal.error).toBeNull();

  const created = await a.rpc('create_treatment_proposal_v1', {
    p_deal_id: seeded.dealId,
    p_title: 'E2E TEST HIDDEN PROPOSAL',
    p_idempotency_key: randomUUID(),
  });
  expect(created.error).toBeNull();
  const createdRow = Array.isArray(created.data) ? created.data[0] : created.data;
  expect(createdRow?.proposal_id).toBeTruthy();

  const saved = await a.rpc('save_treatment_proposal_draft_v1', {
    p_version_id: createdRow!.version_id,
    p_expected_revision: 0,
    p_title: 'E2E TEST HIDDEN PROPOSAL',
    p_valid_until: '2030-12-31',
    p_payment_terms: null,
    p_internal_note: null,
    p_customer_note: null,
    p_discount_type: 'none',
    p_discount_value: 0,
    p_items: [{
      service_id: seeded.serviceId,
      service_name_snapshot: 'E2E TEST Service',
      quantity: 1,
      unit_label: 'sessão',
      list_unit_price_snapshot: 321,
      offered_unit_price: 321,
      discount_type: 'none',
      discount_value: 0,
    }],
  });
  expect(saved.error).toBeNull();

  await browserLogin(page, 'a');
  await page.goto('/crm');
  const card = page.locator('.crm-card').filter({ hasText: 'E2E TEST Contact' }).first();
  await expect(card).toBeVisible();
  await expect(card.getByText('E2E TEST Deal')).not.toBeVisible();
  await expect(card.getByText('E2E TEST Service')).not.toBeVisible();
  const proposalInCard = card.getByText('E2E TEST HIDDEN PROPOSAL');
  if (await proposalInCard.count()) await expect(proposalInCard).not.toBeVisible();

  await page.goto(`/pacientes/${seeded.patientId}?tab=proposals`);
  await expect(page.getByText('Propostas da paciente')).toBeVisible();
  await expect(page.getByText('E2E TEST HIDDEN PROPOSAL')).toBeVisible();
  await expect(page.getByRole('button', { name: /Nova proposta/ })).toBeVisible();

  await page.goto(`/pacientes/${seeded.patientId}?tab=finance`);
  await expect(page.getByText('Financeiro da paciente')).toBeVisible();
  await expect(page.getByText('Histórico comercial')).toHaveCount(0);
});
