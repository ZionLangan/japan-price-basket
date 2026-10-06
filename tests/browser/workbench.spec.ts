import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';

test('city → search → quantities → graph, table, export and browser reload', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const foreignRequests: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://127.0.0.1:4173/')) foreignRequests.push(r.url());
  });
  await page.goto('/');
  await expect(page.locator('.totals')).toContainText('2,098');
  await expect(page.locator('#city option')).toHaveCount(81);
  await page.locator('#search').fill('たまねぎ');
  await page.getByRole('button', { name: /^Add: Onions/ }).click();
  await page.locator('#qty-onions').fill('0.5');
  await page.locator('#unit-onions').selectOption('g');
  await expect(page.locator('#qty-onions')).toHaveValue('500');
  await page.locator('#basket-name').fill('My groceries');
  await page.getByRole('button', { name: 'Save named basket' }).click();
  await expect(page.locator('#saved option')).toHaveCount(2);
  await page.getByRole('button', { name: '日本語', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(page.locator('#qty-onions')).toHaveValue('500');
  await page.reload();
  await expect(page.locator('#qty-onions')).toHaveValue('500');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(page.locator('.price-chart')).toBeVisible();
  await expect(page.locator('.monthly-table tbody tr')).toHaveCount(24);
  const jsonDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '買い物かごのJSONを出力', exact: true }).click();
  const file = await jsonDownload;
  const exported = JSON.parse(await readFile((await file.path())!, 'utf8'));
  expect(exported.items.find((i: { productId: string }) => i.productId === 'onions').quantity).toBe(
    '500',
  );
  await page.getByRole('button', { name: '買い物かごを空にする' }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'basket.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await expect(page.locator('#qty-onions')).toHaveValue('500');
  const csvDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '計算結果のCSVをダウンロード' }).click();
  const csv = await readFile((await (await csvDownload).path())!, 'utf8');
  expect(csv).toContain('actual_anchor_month');
  expect(csv).toContain('"500","g"');
  expect(await context.cookies()).toEqual([]);
  expect(foreignRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('seasonal estimates can be removed without dropping the selected good', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.totals')).toContainText('2,098');
  await page.getByRole('button', { name: 'Clear basket', exact: true }).click();
  await page.locator('#search').fill('mikan');
  await page.getByRole('button', { name: /^Add: Satsuma/ }).click();
  await expect(page.locator('.totals')).toContainText('Estimated');
  await expect(page.locator('.monthly-table tbody tr').last()).toContainText('2026-03');
  await page.getByLabel('Observed prices only', { exact: true }).check();
  await expect(page.locator('.totals')).toContainText('Unavailable');
  await expect(page.locator('#qty-satsuma-mandarins')).toHaveValue('1');
  await page.getByLabel('Observed prices only', { exact: true }).uncheck();
  await expect(page.locator('.totals')).toContainText('Estimated');
});

test('real specification boundary blocks percentages until baseline moves', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.totals')).toContainText('2,098');
  await page.getByRole('button', { name: 'Clear basket', exact: true }).click();
  await page.locator('#search').fill('dish soap');
  await page.getByRole('button', { name: /^Add: Dishwashing/ }).click();
  await expect(page.locator('.totals')).toContainText('No comparable percentage');
  await page.locator('#start').selectOption('2025-10');
  await expect(page.locator('.totals')).not.toContainText('No comparable percentage');
  await expect(page.locator('.monthly-table tbody tr')).toHaveCount(11);
  await page.locator('#city').selectOption('14205');
  await page.locator('#start').selectOption('2024-09');
  await expect(page.locator('.monthly-table tbody tr').first()).toContainText('city not surveyed');
  await expect(page.locator('.city-control')).toContainText('2025-01');
});

test('invalid quantities and basket imports preserve inputs and do not create totals', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.totals')).toContainText('2,098');
  await page.locator('#qty-white-bread').fill('0');
  await expect(page.locator('#qty-white-bread')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('.monthly-table tbody tr')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export basket JSON' })).toBeDisabled();
  await page.locator('#qty-white-bread').fill('0.5');
  await expect(page.locator('.totals')).toContainText('1,815');
  await page.locator('input[type=file]').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"cityId":"wrong"}'),
  });
  await expect(page.getByRole('status').first()).toContainText('invalid or incompatible');
  await expect(page.locator('#qty-white-bread')).toHaveValue('0.5');
});

test('blocked storage and missing city asset have usable recovery paths', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'localStorage', {
      get: () => {
        throw new DOMException('Blocked', 'SecurityError');
      },
    }),
  );
  await page.goto('/');
  await expect(page.locator('.totals')).toContainText('2,098');
  await expect(page.getByText('Browser storage is unavailable.', { exact: false })).toBeVisible();
  await page.route('**/cities/01100.json', (r) => r.fulfill({ status: 503, body: 'Unavailable' }));
  await page.locator('#city').selectOption('01100');
  await expect(page.getByRole('alert')).toContainText('bundled data');
  await page.unroute('**/cities/01100.json');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.monthly-table tbody tr')).toHaveCount(24);
});

test('corrupt saved state is preserved until an explicit save', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('japan-basket-prices:v1', '{broken'));
  await page.goto('/');
  await expect(page.locator('.totals')).toContainText('2,098');
  await expect(page.getByText('Saved data could not be restored', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('japan-basket-prices:v1'))).toBe('{broken');
  await page.getByRole('button', { name: 'Save named basket' }).click();
  expect(
    JSON.parse((await page.evaluate(() => localStorage.getItem('japan-basket-prices:v1')))!),
  ).toHaveProperty('schemaVersion', 1);
});

test('examples, renaming, deleting and reset produce real basket changes', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.totals')).toContainText('2,098');
  await page.locator('#example-kind').selectOption('home');
  await page.getByRole('button', { name: 'Use selected example' }).click();
  await expect(page.locator('#start')).toHaveValue('2025-10');
  await expect(page.locator('.basket-row')).toHaveCount(3);
  await page.getByRole('button', { name: 'Save named basket' }).click();
  await page.locator('#basket-name').fill('Supplies');
  await page.getByRole('button', { name: 'Rename saved basket' }).click();
  await expect(page.locator('#saved option')).toHaveCount(2);
  await expect(page.locator('#saved')).toContainText('Supplies');
  await page.getByRole('button', { name: 'Delete saved basket' }).click();
  await expect(page.locator('#saved option')).toHaveCount(1);
  await page.getByRole('button', { name: 'Reset baskets and preferences' }).click();
  await expect(page.locator('.basket-row')).toHaveCount(5);
  await expect(page.locator('.totals')).toContainText('2,098');
});

test('milk volume controls preserve equivalent quantities and rapid city switching stays correct', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.totals')).toContainText('2,098');
  await page.locator('#search').fill('milk');
  await page.getByRole('button', { name: /^Add: Milk/ }).click();
  await page.locator('#qty-carton-milk').fill('0.5');
  await page.locator('#unit-carton-milk').selectOption('mL');
  await expect(page.locator('#qty-carton-milk')).toHaveValue('500');
  await page.locator('#preset-carton-milk').selectOption('2000');
  await expect(page.locator('#qty-carton-milk')).toHaveValue('2000');
  await page.route('**/cities/01100.json', async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ response });
  });
  await page.locator('#city').selectOption('01100');
  await page.locator('#city').selectOption('47201');
  await expect(page.locator('table caption')).toContainText('Naha');
  await expect(page.locator('.price-chart')).toBeVisible();
});

test('both languages reflow, preserve visible keyboard focus and render real content', async ({
  page,
}, info) => {
  await page.goto('/');
  await expect(page.locator('.totals')).toContainText('2,098');
  for (const language of ['English', '日本語']) {
    await page.getByRole('button', { name: language, exact: true }).click();
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  }
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#search').focus();
  expect(
    await page.locator('#search').evaluate((el) => getComputedStyle(el).outlineStyle),
  ).not.toBe('none');
  await page.screenshot({ path: `test-results/${info.project.name}-ja-mobile.png` });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.screenshot({ path: `test-results/${info.project.name}-en-desktop.png` });
  await page.setViewportSize({ width: 768, height: 1000 });
  await page.addStyleTag({ content: ':root {font-size: 200%;}' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('default workbench has no detected accessibility violations in either language', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.totals')).toContainText('2,098');
  for (const language of ['English', '日本語']) {
    await page.getByRole('button', { name: language, exact: true }).click();
    const result = await new AxeBuilder({ page }).analyze();
    expect(result.violations).toEqual([]);
  }
});
