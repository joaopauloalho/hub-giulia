import fs from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { browserLogin } from './helpers';

type E2EState = { patientId: string };
const readState = async () => JSON.parse(await fs.readFile('.e2e-state.json', 'utf8')) as E2EState;

test('Global Search finds own patient and does not leak it to another tenant', async ({ page }) => {
  const seeded = await readState();

  await browserLogin(page, 'a');
  await page.getByRole('button', { name: 'Buscar no Hub' }).click();
  const search = page.getByRole('textbox', { name: 'Buscar paciente ou lead' });
  await search.fill('E2E TEST Seed Patient');
  const ownResult = page.getByRole('button').filter({ hasText: 'E2E TEST Seed Patient' });
  await expect(ownResult).toHaveCount(1);
  await ownResult.click();
  await expect(page).toHaveURL(new RegExp(`/pacientes/${seeded.patientId}$`));

  await page.getByRole('button', { name: 'Sair' }).click({ force: true });
  await expect(page).toHaveURL(/\/login$/);
  await browserLogin(page, 'b');
  await page.getByRole('button', { name: 'Buscar no Hub' }).click();
  await page.getByRole('textbox', { name: 'Buscar paciente ou lead' }).fill('E2E TEST Seed Patient');
  await expect(page.getByText('Nenhum resultado encontrado.')).toBeVisible();
});
