import fs from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { browserLogin } from './helpers';

type E2EState = { patientId: string; appointmentId: string };
const readState = async () => JSON.parse(await fs.readFile('.e2e-state.json', 'utf8')) as E2EState;

test('critical authenticated routes render without uncaught browser errors', async ({ page }) => {
  const seeded = await readState();
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.name));

  await browserLogin(page, 'a');
  await page.setViewportSize({ width: 1440, height: 900 });

  const routes = [
    '/dashboard',
    '/agenda',
    '/comunicacao',
    '/relacionamento',
    `/pacientes/${seeded.patientId}`,
    `/atendimento/${seeded.appointmentId}`,
    '/financeiro',
    '/retornos',
    '/crm',
    '/saude',
  ];

  for (const route of routes) {
    await page.goto(route);
    await expect(page).not.toHaveURL(/\/login$/);
    await expect(page.locator('main.app-main')).toBeVisible();
    await expect(page.getByText('Algo deu errado.', { exact: true })).toHaveCount(0);
  }

  expect(pageErrors).toEqual([]);
});

test('supported iPhone, iPad and desktop viewports keep the operational shell usable', async ({ page }) => {
  await browserLogin(page, 'a');
  const viewports = [
    { width: 390, height: 844, label: 'iPhone 390x844' },
    { width: 430, height: 932, label: 'iPhone 430x932' },
    { width: 768, height: 1024, label: 'iPad portrait 768x1024' },
    { width: 1024, height: 768, label: 'iPad landscape 1024x768' },
    { width: 1180, height: 820, label: 'iPad landscape 1180x820' },
    { width: 1366, height: 1024, label: 'large tablet 1366x1024' },
    { width: 1440, height: 900, label: 'desktop 1440x900' },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/dashboard');
    await expect(page.locator('main.app-main'), viewport.label).toBeVisible();
    await expect(page.getByText('Algo deu errado.', { exact: true }), viewport.label).toHaveCount(0);

    await page.goto('/agenda');
    await expect(page.locator('main.app-main'), `${viewport.label} agenda`).toBeVisible();
    await expect(page.getByText('Algo deu errado.', { exact: true }), `${viewport.label} agenda`).toHaveCount(0);
  }
});

test('PWA manifest/service worker exist and authenticated API responses never enter Cache Storage', async ({ page }) => {
  await browserLogin(page, 'a');

  const manifestResponse = await page.request.get('/manifest.webmanifest');
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json() as { name?: string; display?: string };
  expect(manifest.name).toBeTruthy();
  expect(manifest.display).toBe('standalone');

  await page.goto('/dashboard');
  const swState = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false, controlled: false };
    const registration = await navigator.serviceWorker.ready;
    return { supported: true, controlled: Boolean(navigator.serviceWorker.controller), active: Boolean(registration.active) };
  });
  expect(swState.supported).toBeTruthy();
  expect(swState.active).toBeTruthy();

  const leaked = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const cacheName of await caches.keys()) {
      const cache = await caches.open(cacheName);
      for (const request of await cache.keys()) {
        if (/\/rest\/v1\/|\/auth\/v1\/|\/storage\/v1\/|\/functions\/v1\//.test(request.url)) urls.push(request.url);
      }
    }
    return urls;
  });
  expect(leaked).toEqual([]);
});
