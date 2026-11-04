import { expect, test } from '@playwright/test';
import { browserLogin, signedInClient } from './helpers';

test('protected route redirects, login works, patient double-submit is guarded and logout purges private session state', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);

  await browserLogin(page, 'a');
  await expect(page).toHaveURL(/\/agenda$/);

  await page.getByRole('link', { name: 'Pacientes' }).click();
  await expect(page.getByRole('heading', { name: 'Pacientes' })).toBeVisible();

  const createButton = page.getByRole('button', { name: /Cadastrar primeira paciente|Nova paciente/i }).first();
  await createButton.click();
  await expect(page.getByRole('heading', { name: 'Nova Paciente' })).toBeVisible();

  const uniqueName = `E2E TEST UI Patient ${Date.now()}`;
  await page.getByPlaceholder('Nome completo').fill(uniqueName);
  await page.getByPlaceholder('email@exemplo.com').fill(`ui-${Date.now()}@hub-giulia.local`);

  const save = page.getByRole('button', { name: 'Cadastrar' });
  await save.dblclick({ delay: 5 });
  await expect(page.getByText('Paciente cadastrada com sucesso.')).toBeVisible();

  const client = await signedInClient('a');
  const { data: matches, error } = await client.from('patients').select('id,name').eq('name', uniqueName);
  expect(error).toBeNull();
  expect(matches).toHaveLength(1);

  await page.getByPlaceholder('Buscar por nome, celular ou email...').fill(uniqueName);
  await page.getByText(uniqueName, { exact: true }).click();
  await expect(page.getByText(uniqueName, { exact: true }).first()).toBeVisible();
  await expect(page).toHaveURL(/\/pacientes\/[0-9a-f-]+$/);

  // Patient360 is route-backed. Use its explicit close control and wait for the
  // route transition before touching the navigation rail to avoid a reopen race.
  const drawerOverlay = page.locator('.drawer-overlay');
  await expect(drawerOverlay).toBeVisible();
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.waitForURL('**/pacientes');
  await expect(drawerOverlay).toHaveCount(0);

  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/login$/);

  const privateState = await page.evaluate(async () => {
    const authKeys = Object.keys(localStorage).filter(key => /auth-token|supabase/i.test(key));
    const cacheNames = await caches.keys();
    const privateCachedRequests: string[] = [];
    for (const cacheName of cacheNames) {
      const cache = await caches.open(cacheName);
      const requests = await cache.keys();
      for (const request of requests) {
        if (/\/rest\/v1\/|\/auth\/v1\/|\/storage\/v1\/|\/functions\/v1\//.test(request.url)) {
          privateCachedRequests.push(request.url);
        }
      }
    }
    return { authKeys, privateCachedRequests };
  });
  expect(privateState.authKeys).toEqual([]);
  expect(privateState.privateCachedRequests).toEqual([]);
});
