import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { browserLogin, signedInClient } from './helpers';

function clinicToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function birthDateForToday(year = 1990) {
  const [, month, day] = clinicToday().split('-');
  return `${year}-${month}-${day}`;
}

test('birthdays appear for the right tenant and disappear after contact is recorded', async ({ page }) => {
  const a = await signedInClient('a');
  const b = await signedInClient('b');
  const name = `E2E Birthday ${randomUUID().slice(0, 8)}`;
  const inserted = await a.from('patients').insert({
    name,
    phone: '43999998888',
    birth_date: birthDateForToday(),
  }).select('id').single();
  expect(inserted.error).toBeNull();
  const patientId = inserted.data!.id as string;

  const counts = await a.rpc('get_relationship_opportunity_counts_v2');
  expect(counts.error).toBeNull();
  expect(Number(counts.data?.birthday)).toBeGreaterThanOrEqual(1);
  expect(Number(counts.data?.birthday_today)).toBeGreaterThanOrEqual(1);

  const own = await a.rpc('list_relationship_opportunities_v2', {
    p_category: 'birthday', p_search: name, p_include_snoozed: false, p_limit: 50, p_offset: 0,
  });
  expect(own.error).toBeNull();
  expect((own.data ?? []).some((row: { patient_id?: string; display_name?: string }) => row.patient_id === patientId && row.display_name === name)).toBe(true);

  const otherTenant = await b.rpc('list_relationship_opportunities_v2', {
    p_category: 'birthday', p_search: name, p_include_snoozed: true, p_limit: 50, p_offset: 0,
  });
  expect(otherTenant.error).toBeNull();
  expect((otherTenant.data ?? []).some((row: { display_name?: string }) => row.display_name === name)).toBe(false);

  await browserLogin(page, 'a');
  await page.goto('/relacionamento');
  await expect(page.getByText(name)).toBeVisible();
  await expect(page.getByText('Aniversário hoje').first()).toBeVisible();
  const personCard = page.locator('.relationship-person-card').filter({ hasText: name }).first();
  await personCard.getByRole('button', { name: 'WhatsApp' }).click();
  await expect(page.getByRole('dialog', { name: 'Mensagem de relacionamento' })).toBeVisible();
  await expect(page.getByLabel('Mensagem')).toContainText('feliz aniversário');
  await page.getByRole('button', { name: 'Fechar' }).click();

  const recorded = await a.rpc('record_relationship_birthday_contact_v1', {
    p_patient_id: patientId,
    p_recipient_phone: '43999998888',
    p_message_body: 'Feliz aniversário!',
    p_idempotency_key: randomUUID(),
  });
  expect(recorded.error).toBeNull();

  const after = await a.rpc('list_relationship_opportunities_v2', {
    p_category: 'birthday', p_search: name, p_include_snoozed: true, p_limit: 50, p_offset: 0,
  });
  expect(after.error).toBeNull();
  expect((after.data ?? []).some((row: { patient_id?: string }) => row.patient_id === patientId)).toBe(false);
});
