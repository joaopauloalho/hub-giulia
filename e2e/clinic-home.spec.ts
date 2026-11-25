import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { browserLogin, signedInClient } from './helpers';

async function shot(page: Page, name: string) {
  const dir = process.env.SCREENSHOT_DIR;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true, animations: 'disabled' });
}

function birthDateForToday(year = 1991) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const [, month, day] = today.split('-');
  return `${year}-${month}-${day}`;
}

test('Hoje, indicações, aniversários and retenção are separate simple screens', async ({ page }) => {
  const client = await signedInClient('a');
  const referrer = await client.from('patients').insert({ name: `E2E Indicadora ${randomUUID().slice(0, 6)}` }).select('id').single();
  expect(referrer.error).toBeNull();
  const birthday = await client.from('patients').insert({
    name: `E2E Aniversario ${randomUUID().slice(0, 6)}`,
    phone: '43988887777',
    birth_date: birthDateForToday(),
  }).select('id,name').single();
  expect(birthday.error).toBeNull();
  const referredName = `E2E Indicada ${randomUUID().slice(0, 6)}`;
  const referral = await client.from('referrals').insert({
    referrer_patient_id: referrer.data!.id,
    referred_name: referredName,
    referred_phone: '(43) 98888-7766',
  }).select('id').single();
  expect(referral.error).toBeNull();

  await browserLogin(page, 'a');
  await expect(page.getByRole('heading', { name: 'Hoje' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Lançar' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Chamar' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cobrar' })).toBeVisible();
  await shot(page, 'hoje-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'hoje-mobile');
  await page.setViewportSize({ width: 1280, height: 800 });
  const nav = page.getByRole('navigation', { name: 'Navegação principal' });
  await expect(nav.getByRole('link', { name: 'Comunicação' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Agenda' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Retenção' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Indicações' })).toBeVisible();

  await page.getByRole('link', { name: 'Indicações' }).click();
  await expect(page.getByRole('heading', { name: 'Indicações' })).toBeVisible();
  await expect(page.getByText(referredName)).toBeVisible();
  await expect(page.getByText(/Indicada ·/)).toBeVisible();
  await shot(page, 'indicacoes');

  await page.goto('/retencao');
  await expect(page.getByRole('heading', { name: 'Retenção' })).toBeVisible();
  await expect(page.getByText('Taxa de retorno')).toBeVisible();
  await expect(page.getByText('Valor pago')).toBeVisible();
  await shot(page, 'retencao');

  await page.goto('/aniversarios');
  await expect(page.getByRole('heading', { name: 'Aniversários' })).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(birthday.data!.name) })).toBeVisible();
  await expect(page.getByLabel('Texto do WhatsApp')).toBeVisible();
  await expect(page.getByLabel('Texto do WhatsApp')).not.toHaveValue(/desconto/i);
  await page.getByRole('button', { name: new RegExp(birthday.data!.name) }).click();
  await shot(page, 'aniversario');
});
