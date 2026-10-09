import { expect, test } from '@playwright/test';
import { expectRange, selectMonth } from './helpers/dates';

test('expanded foods are bilingual and miso keeps a fixed weight across a package-size change', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('latest-cost')).toHaveText('¥2,098');
  await page.getByRole('button', { name: 'Clear basket', exact: true }).click();
  await page.locator('#search').fill('みそ');
  await page.getByRole('option', { name: /^Add: Miso/ }).click();
  await page.locator('#qty-miso').fill('1');
  await expectRange(page, '2000-01', '2026-08');
  await expect(page.getByTestId('basket-change')).not.toHaveText('—');
  await page.getByRole('tab', { name: 'Monthly data', exact: true }).click();
  const rows = page.locator('.monthly-table tbody tr');
  await expect(rows.filter({ hasText: '2009-06' })).toContainText('¥420');
  await expect(rows.filter({ hasText: '2009-07' })).toContainText('¥499');
  await page.locator('#unit-miso').selectOption('g');
  await expect(page.locator('#qty-miso')).toHaveValue('1000');
  await page.getByRole('button', { name: '日本語', exact: true }).click();
  await page.locator('#search').fill('chicken');
  await page.getByRole('option', { name: /^追加: 鶏もも肉/ }).click();
  await expect(page.locator('#qty-chicken-thigh')).toBeVisible();
  await page.reload();
  await expect(page.locator('#qty-miso')).toHaveValue('1000');
  await expect(page.locator('#qty-chicken-thigh')).toBeVisible();
  await expect(page.getByTestId('basket-change')).not.toHaveText('—');
});

test('genuine later starts remain guarded and scheduled off-seasons keep actual price anchors', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('latest-cost')).toHaveText('¥2,098');
  await page.getByRole('button', { name: 'Clear basket', exact: true }).click();
  await selectMonth(page, 'start', '2020-12');
  await page.locator('#search').fill('curry bread');
  await page.getByRole('option', { name: /^Add: Curry bread/ }).click();
  await page.locator('.range-presets button').filter({ hasText: /^All$/ }).click();
  await expectRange(page, '2020-12', '2026-08');
  await expect(page.getByTestId('compatibility-notice')).toContainText('Curry bread');
  await page.getByRole('button', { name: 'Clear basket', exact: true }).click();
  await selectMonth(page, 'start', '2000-01');
  await page.locator('#search').fill('strawberries');
  await page.getByRole('option', { name: /^Add: Strawberries/ }).click();
  const chart = page.locator('.price-chart');
  await chart.focus();
  await chart.press('Home');
  for (let i = 0; i < 5; i++) await chart.press('ArrowRight');
  await expect(page.getByTestId('chart-tooltip')).toContainText('2000-06');
  await expect(page.getByTestId('chart-tooltip')).toContainText('Estimated');
  await expect(page.getByTestId('chart-tooltip')).toContainText('2000-05');
});
