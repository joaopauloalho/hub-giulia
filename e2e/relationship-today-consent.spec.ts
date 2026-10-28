import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { browserLogin, signedInClient } from './helpers';

function todayBirthday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  return '1990-' + parts.slice(5);
}

test('WhatsApp requires explicit patient consent, and revocation removes all relationship sources', async ({ page }) => {
  const a = await signedInClient('a');
  const b = await signedInClient('b');
  const name = 'E2E Consent ' + randomUUID().slice(0, 8);
  const inserted = await a.from('patients').insert({
    name, phone: '43999998888', birth_date: todayBirthday(),
  }).select('id').single();
  expect(inserted.error).toBeNull();
  const patientId = inserted.data!.id as string;

  const own = await a.rpc('list_relationship_opportunities_v2', {
    p_category: 'birthday', p_search: name, p_include_snoozed: true, p_limit: 50, p_offset: 0,
  });
  expect(own.error).toBeNull();
  expect((own.data ?? []).some((person: { patient_id?: string }) => person.patient_id === patientId)).toBe(true);

  await browserLogin(page);
  await page.goto('/relacionamento');
  const person = page.locator('.relationship-person-card').filter({ hasText: name });
  await expect(person).toBeVisible();
  await expect(person.getByRole('button', { name: 'WhatsApp' })).toBeDisabled();

  const optIn = await a.rpc('set_patient_whatsapp_consent_v1', { p_patient_id: patientId, p_opt_in: true, p_source: 'ficha' });
  expect(optIn.error).toBeNull();
  await page.reload();
  await expect(page.locator('.relationship-person-card').filter({ hasText: name }).getByRole('button', { name: 'WhatsApp' })).toBeEnabled();

  const optOut = await a.rpc('set_patient_whatsapp_consent_v1', { p_patient_id: patientId, p_opt_in: false, p_source: 'revogacao' });
  expect(optOut.error).toBeNull();
  const after = await a.rpc('list_relationship_opportunities_v2', {
    p_category: 'birthday', p_search: name, p_include_snoozed: true, p_limit: 50, p_offset: 0,
  });
  expect(after.error).toBeNull();
  expect((after.data ?? []).some((person: { patient_id?: string }) => person.patient_id === patientId)).toBe(false);

  const other = await b.from('patients').select('whatsapp_opt_in').eq('id', patientId);
  expect(other.error).toBeNull();
  expect(other.data).toHaveLength(0);
  const unauthorized = await b.rpc('set_patient_whatsapp_consent_v1', { p_patient_id: patientId, p_opt_in: true, p_source: 'ficha' });
  expect(unauthorized.error).not.toBeNull();
});
