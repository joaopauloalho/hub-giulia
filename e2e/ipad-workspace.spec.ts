import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { browserLogin } from './helpers';

type E2EState = { patientId: string; appointmentId: string };
const readState = async () => JSON.parse(await fs.readFile('.e2e-state.json', 'utf8')) as E2EState;

const viewports = [
  { width: 390, height: 844, label: '390x844' },
  { width: 430, height: 932, label: '430x932' },
  { width: 768, height: 1024, label: '768x1024' },
  { width: 1024, height: 768, label: '1024x768' },
  { width: 1180, height: 820, label: '1180x820' },
  { width: 1366, height: 1024, label: '1366x1024' },
  { width: 1440, height: 900, label: '1440x900' },
];

async function expectNoRootOverflow(page: Page, label: string) {
  const dimensions = await page.evaluate(() => ({
    htmlScroll: document.documentElement.scrollWidth,
    htmlClient: document.documentElement.clientWidth,
    bodyScroll: document.body.scrollWidth,
    bodyClient: document.body.clientWidth,
  }));
  expect(dimensions.htmlScroll, `${label}: html horizontal overflow`).toBeLessThanOrEqual(dimensions.htmlClient + 1);
  expect(dimensions.bodyScroll, `${label}: body horizontal overflow`).toBeLessThanOrEqual(dimensions.bodyClient + 1);
}

test('operational shell changes posture without horizontal overflow', async ({ page }) => {
  await browserLogin(page, 'a');

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/dashboard');
    await expect(page.locator('main.app-main')).toBeVisible();
    await expectNoRootOverflow(page, `dashboard ${viewport.label}`);

    if (viewport.width >= 768) {
      await expect(page.locator('.side-rail'), `${viewport.label}: side rail`).toBeVisible();
      await expect(page.locator('.bottom-tabs'), `${viewport.label}: bottom tabs`).toBeHidden();
    } else {
      await expect(page.locator('.side-rail'), `${viewport.label}: side rail`).toBeHidden();
      await expect(page.locator('.bottom-tabs'), `${viewport.label}: bottom tabs`).toBeVisible();
    }
  }
});

test('Patient 360 becomes master-detail on iPad landscape and reacts to rotation', async ({ page }) => {
  const seeded = await readState();
  await browserLogin(page, 'a');

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto(`/pacientes/${seeded.patientId}?tab=data`);
  await expect(page.locator('.patient-360-drawer')).toBeVisible();
  const portraitDirection = await page.locator('.patient-360-tabs').evaluate(element => getComputedStyle(element).flexDirection);
  expect(portraitDirection).toBe('row');
  await expectNoRootOverflow(page, 'patient portrait');

  await page.setViewportSize({ width: 1180, height: 820 });
  await expect.poll(async () => page.locator('.patient-360-tabs').evaluate(element => getComputedStyle(element).flexDirection)).toBe('column');
  await expectNoRootOverflow(page, 'patient landscape');

  await expect.poll(async () => {
    const navBox = await page.locator('.patient-360-tabs').boundingBox();
    const bodyBox = await page.locator('.patient-360-drawer .drawer-body').boundingBox();
    if (!navBox || !bodyBox) return Number.POSITIVE_INFINITY;
    return Math.abs(navBox.y - bodyBox.y);
  }, { message: 'Patient 360 master-detail columns should settle on the same top edge' }).toBeLessThan(3);

  const nav = await page.locator('.patient-360-tabs').boundingBox();
  const body = await page.locator('.patient-360-drawer .drawer-body').boundingBox();
  expect(nav).not.toBeNull();
  expect(body).not.toBeNull();
  expect(nav!.x).toBeLessThan(body!.x);

  await expect(page.locator('.patient-data-card')).toHaveCount(6);
  const cards = await page.locator('.patient-data-card').evaluateAll(elements => elements.slice(0, 2).map(element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width };
  }));
  expect(cards).toHaveLength(2);
  expect(Math.abs(cards[0].y - cards[1].y)).toBeLessThan(3);
  expect(cards[1].x).toBeGreaterThan(cards[0].x + cards[0].width - 2);

  const actionHeights = await page.locator('.patient-quick-actions .btn').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
  expect(actionHeights.length).toBeGreaterThan(0);
  expect(Math.min(...actionHeights)).toBeGreaterThanOrEqual(44);
});

test('Registrar CTA follows the actual tablet workspace instead of the hidden bottom nav', async ({ page }) => {
  await browserLogin(page, 'a');
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto('/registrar');

  const route = page.locator('.registrar-route');
  const cta = route.locator('.btn-primary').filter({ hasText: 'Continuar' });
  await expect(route).toBeVisible();
  await expect(cta).toBeVisible();
  const routeBox = await route.boundingBox();
  const ctaBox = await cta.boundingBox();
  expect(routeBox).not.toBeNull();
  expect(ctaBox).not.toBeNull();
  const routeCenter = routeBox!.x + routeBox!.width / 2;
  const ctaCenter = ctaBox!.x + ctaBox!.width / 2;
  expect(Math.abs(routeCenter - ctaCenter)).toBeLessThan(3);
  expect(ctaBox!.y + ctaBox!.height).toBeLessThanOrEqual(820 - 14);
  await expectNoRootOverflow(page, 'registrar landscape');
});

test('Anamnese keeps two-pane navigation and touch-friendly binary choices on iPad', async ({ page }) => {
  const seeded = await readState();
  await browserLogin(page, 'a');
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto(`/pacientes/${seeded.patientId}/anamnese`);

  await expect(page.locator('.anamnesis-editor-layout')).toBeVisible();
  const nav = await page.locator('.anamnesis-section-nav').boundingBox();
  const form = await page.locator('.anamnesis-form').boundingBox();
  expect(nav).not.toBeNull();
  expect(form).not.toBeNull();
  expect(nav!.x).toBeLessThan(form!.x);

  const choiceHeights = await page.locator('.anamnesis-choice-group button').evaluateAll(elements => elements.slice(0, 12).map(element => element.getBoundingClientRect().height));
  expect(choiceHeights.length).toBeGreaterThan(0);
  expect(Math.min(...choiceHeights)).toBeGreaterThanOrEqual(44);
  await expectNoRootOverflow(page, 'anamnese landscape');
});

test('Dashboard, Financeiro and CRM preserve productive landscape density', async ({ page }) => {
  await browserLogin(page, 'a');
  await page.setViewportSize({ width: 1180, height: 820 });

  await page.goto('/dashboard');
  const dashboard = page.locator('.dashboard-page');
  await expect(dashboard).toBeVisible();
  await expect(page.locator('.dashboard-period-bar')).toBeVisible();
  const dashboardBox = await dashboard.boundingBox();
  expect(dashboardBox).not.toBeNull();
  expect(dashboardBox!.width).toBeGreaterThanOrEqual(1000);
  const dashboardPaddingBottom = await dashboard.evaluate(element => parseFloat(getComputedStyle(element).paddingBottom));
  expect(dashboardPaddingBottom).toBeLessThanOrEqual(48);
  await expectNoRootOverflow(page, 'dashboard productive density');

  await page.goto('/financeiro');
  await page.getByRole('tab', { name: 'Por serviço' }).click();
  const financialSummary = page.locator('.sf-summary-grid');
  await expect(financialSummary).toBeVisible();
  const financialColumns = await financialSummary.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length);
  expect(financialColumns).toBe(5);
  const financialHeader = page.locator('.sf-list-header');
  if (await financialHeader.count()) await expect(financialHeader).toBeVisible();
  await expectNoRootOverflow(page, 'financeiro productive density');

  await page.goto('/crm');
  const board = page.locator('.crm-board');
  await expect(board).toBeVisible();
  await expect(page.locator('.crm-mobile-list')).toBeHidden();
  const boardBehavior = await board.evaluate(element => {
    const style = getComputedStyle(element);
    return { overflowX: style.overflowX, overscrollX: style.overscrollBehaviorX };
  });
  expect(boardBehavior.overflowX).toBe('auto');
  expect(boardBehavior.overscrollX).toBe('contain');
  const visibleBoardCards = board.locator('.crm-card');
  if (await visibleBoardCards.count()) {
    const minCardHeight = Math.min(...await visibleBoardCards.evaluateAll(elements => elements.slice(0, 12).map(element => element.getBoundingClientRect().height)));
    expect(minCardHeight).toBeGreaterThanOrEqual(44);
  }
  await expectNoRootOverflow(page, 'crm productive density');
});

test('critical iPad routes keep primary content inside the viewport', async ({ page }) => {
  const seeded = await readState();
  await browserLogin(page, 'a');
  await page.setViewportSize({ width: 1180, height: 820 });

  const routes = ['/agenda', '/registrar', '/catalogo', '/financeiro', '/crm', `/pacientes/${seeded.patientId}`];
  for (const route of routes) {
    await page.goto(route);
    await expect(page.locator('main.app-main'), route).toBeVisible();
    await expect(page.getByText('Algo deu errado.', { exact: true }), route).toHaveCount(0);
    await expectNoRootOverflow(page, route);
  }
});

test('capture responsive workspace evidence', async ({ page }) => {
  const seeded = await readState();
  await browserLogin(page, 'a');
  const outputDir = path.join('artifacts', 'ui-audit');
  await fs.mkdir(outputDir, { recursive: true });

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/dashboard');
    await expect(page.locator('main.app-main')).toBeVisible();
    await page.screenshot({ path: path.join(outputDir, `dashboard-${viewport.label}.png`), fullPage: true, animations: 'disabled' });
  }

  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto(`/pacientes/${seeded.patientId}?tab=data`);
  await expect(page.locator('.patient-data-card')).toHaveCount(6);
  await page.screenshot({ path: path.join(outputDir, 'patient-data-1180x820.png'), fullPage: true, animations: 'disabled' });

  await page.goto('/agenda');
  await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible();
  await page.screenshot({ path: path.join(outputDir, 'agenda-1180x820.png'), fullPage: true, animations: 'disabled' });

  await page.goto('/registrar');
  await expect(page.getByRole('heading', { name: 'Registrar atendimento' })).toBeVisible();
  await page.screenshot({ path: path.join(outputDir, 'registrar-1180x820.png'), fullPage: true, animations: 'disabled' });

  await page.goto(`/pacientes/${seeded.patientId}/anamnese`);
  await expect(page.locator('.anamnesis-editor-layout')).toBeVisible();
  await page.screenshot({ path: path.join(outputDir, 'anamnese-1180x820.png'), fullPage: true, animations: 'disabled' });

  await page.goto('/financeiro');
  await page.getByRole('tab', { name: 'Por serviço' }).click();
  await expect(page.locator('.sf-summary-grid')).toBeVisible();
  await page.screenshot({ path: path.join(outputDir, 'financeiro-servicos-1180x820.png'), fullPage: true, animations: 'disabled' });

  await page.goto('/crm');
  await expect(page.locator('.crm-board')).toBeVisible();
  await page.screenshot({ path: path.join(outputDir, 'crm-1180x820.png'), fullPage: true, animations: 'disabled' });
});
