import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { browserLogin, signedInClient } from './helpers';

type E2EState = { dealId: string; serviceId: string; patientId: string };
const readState = async () => JSON.parse(await fs.readFile('.e2e-state.json', 'utf8')) as E2EState;

test('CRM stays clean while proposal is a simple patient budget and can be deleted', async ({ page }) => {
  const seeded = await readState();
  const a = await signedInClient('a');

  const resetDeal = await a.from('deals').update({ stage: 'contacted', value: 100 }).eq('id', seeded.dealId);
  expect(resetDeal.error).toBeNull();

  const created = await a.rpc('create_treatment_proposal_v1', {
    p_deal_id: seeded.dealId,
    p_title: 'E2E TEST SIMPLE PROPOSAL',
    p_idempotency_key: randomUUID(),
  });
  expect(created.error).toBeNull();
  const createdRow = Array.isArray(created.data) ? created.data[0] : created.data;
  expect(createdRow?.proposal_id).toBeTruthy();

  const saved = await a.rpc('save_treatment_proposal_draft_v2', {
    p_version_id: createdRow!.version_id,
    p_expected_revision: 0,
    p_title: 'E2E TEST SIMPLE PROPOSAL',
    p_valid_until: '2030-12-31',
    p_payment_terms: null,
    p_internal_note: null,
    p_customer_note: 'E2E TEST general note',
    p_discount_type: 'none',
    p_discount_value: 0,
    p_items: [{
      service_id: seeded.serviceId,
      service_name_snapshot: 'E2E TEST Service',
      payment_condition: 'PIX à vista ou 6x sem juros',
      interval_note: 'E2E TEST 5 sessões',
      quantity: 1,
      unit_label: 'procedimento',
      list_unit_price_snapshot: 321,
      offered_unit_price: 321,
      discount_type: 'none',
      discount_value: 0,
    }],
  });
  expect(saved.error).toBeNull();

  const item = await a.from('treatment_proposal_items').select('payment_condition,interval_note,line_total').eq('proposal_version_id', createdRow!.version_id).single();
  expect(item.error).toBeNull();
  expect(item.data?.payment_condition).toBe('PIX à vista ou 6x sem juros');
  expect(Number(item.data?.line_total)).toBe(321);

  const advanced = await a.rpc('advance_crm_for_treatment_proposal_v1', { p_proposal_id: createdRow!.proposal_id });
  expect(advanced.error).toBeNull();
  const proposalStage = await a.from('deals').select('stage').eq('id', seeded.dealId).single();
  expect(proposalStage.data?.stage).toBe('proposal_sent');

  expect((await a.from('deals').update({ stage: 'negotiation' }).eq('id', seeded.dealId)).error).toBeNull();
  expect((await a.rpc('advance_crm_for_treatment_proposal_v1', { p_proposal_id: createdRow!.proposal_id })).error).toBeNull();
  const protectedStage = await a.from('deals').select('stage').eq('id', seeded.dealId).single();
  expect(protectedStage.data?.stage).toBe('negotiation');

  await browserLogin(page, 'a');
  await page.goto('/crm');
  const stageNav = page.locator('.crm-stage-segments').first();
  await expect(stageNav.getByRole('button', { name: 'Em contato', exact: true })).toBeVisible();
  await expect(stageNav.getByRole('button', { name: 'Proposta enviada', exact: true })).toBeVisible();
  await expect(page.getByText('Novo', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Novo contato/ })).toBeVisible();
  await expect(page.getByLabel('Filtrar tipo de paciente')).toBeVisible();

  const card = page.locator('.crm-card').filter({ hasText: 'E2E TEST Seed Patient' }).first();
  await expect(card).toBeVisible();
  await expect(card.getByText('E2E TEST Deal')).toHaveCount(0);
  await expect(card.getByText('E2E TEST Service')).toHaveCount(0);
  await expect(card.getByText('E2E TEST SIMPLE PROPOSAL')).toHaveCount(0);
  await expect(card.getByText('R$ 100,00')).toHaveCount(0);

  await card.getByRole('button').first().click();
  await expect(page.getByRole('button', { name: /Abrir paciente/ })).toBeVisible();
  await expect(page.getByText('E2E TEST SIMPLE PROPOSAL')).toHaveCount(0);

  await page.goto(`/pacientes/${seeded.patientId}?tab=proposals`);
  await expect(page.getByText('Propostas da paciente')).toBeVisible();
  await expect(page.getByText('E2E TEST SIMPLE PROPOSAL')).toBeVisible();
  await expect(page.getByRole('button', { name: /Nova proposta/ })).toBeVisible();

  await page.getByText('E2E TEST SIMPLE PROPOSAL').click();
  await expect(page.getByLabel('Valor proposto')).toHaveValue('321');
  await expect(page.getByLabel('Condição de pagamento')).toHaveValue('PIX à vista ou 6x sem juros');
  await expect(page.getByText('Marcar como proposta enviada no CRM')).toBeVisible();
  await expect(page.getByRole('button', { name: /Emitir proposta/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Aceitar/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Recusar/ })).toHaveCount(0);

  await page.goto(`/pacientes/${seeded.patientId}?tab=finance`);
  await expect(page.getByText('Financeiro da paciente')).toBeVisible();
  await expect(page.getByText('Histórico comercial')).toHaveCount(0);
  await expect(page.getByText('E2E TEST SIMPLE PROPOSAL')).toHaveCount(0);

  const deleted = await a.rpc('delete_treatment_proposal_v2', { p_proposal_id: createdRow!.proposal_id });
  expect(deleted.error).toBeNull();
  expect(deleted.data).toBe(true);
  expect((await a.from('treatment_proposals').select('id').eq('id', createdRow!.proposal_id)).data).toHaveLength(0);
  expect((await a.from('treatment_proposal_versions').select('id').eq('proposal_id', createdRow!.proposal_id)).data).toHaveLength(0);
  expect((await a.from('treatment_proposal_items').select('id').eq('proposal_version_id', createdRow!.version_id)).data).toHaveLength(0);
});
