import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Release } from '../../packages/domain/src/contracts';
import { expectRange, selectMonth } from './helpers/dates';

async function load(page: import('@playwright/test').Page) {
  const pointer = await (await page.request.get('/data/current.json')).json();
  const release: Release = await (await page.request.get(`/data/${pointer.manifest}`)).json();
  await page.goto('/');
  await expect(page.getByTestId('latest-cost')).toHaveText('¥2,098');
  return release;
}

test('the full monthly archive starts in January 2000 and all chart views use its actual prices', async ({
  page,
}) => {
  await load(page);
  await expectRange(page, '2000-01', '2026-08');
  await expect(page.getByTestId('basket-change')).toHaveText('+55.3%');
  const chart = page.locator('.price-chart');
  await chart.focus();
  await chart.press('Home');
  await expect(page.getByTestId('chart-tooltip')).toContainText('2000-01');
  await expect(page.getByTestId('chart-tooltip')).toContainText('¥1,351');
  await page.locator('#qty-white-bread').fill('0.5');
  await chart.focus();
  await chart.press('Home');
  await expect(page.getByTestId('chart-tooltip')).toContainText('¥1,140');
  await expect(page.getByTestId('latest-cost')).toHaveText('¥1,815');
  await page.getByRole('tab', { name: 'Monthly data', exact: true }).click();
  await expect(page.locator('.monthly-table tbody tr')).toHaveCount(320);
  await expect(page.locator('.monthly-table tbody tr').first()).toContainText('¥1,140');
  await expect(page.locator('.monthly-table tbody tr').last()).toContainText('¥1,815');
});

test('historical powder remains selectable and never becomes liquid when its survey ends', async ({
  page,
}) => {
  const release = await load(page);
  const powder = release.products.find((product) => product.id === 'powder-laundry-detergent')!;
  await page.getByRole('button', { name: 'Clear basket', exact: true }).click();
  await page.locator('#search').fill('laundry detergent');
  const option = page.getByRole('option', { name: `Add: ${powder.names.en}`, exact: true });
  await expect(option).toContainText('2000-01');
  await expect(option).toContainText('2014-02');
  await option.click();
  await expect(page.getByTestId('latest-cost')).toHaveText('—');
  await expect(page.locator('.quality-summary')).toContainText(
    'This product form was not surveyed',
  );
  await selectMonth(page, 'end', '2000-01');
  await expect(page.getByTestId('latest-cost')).not.toHaveText('—');
  await page
    .getByRole('button', { name: `Specification and history: ${powder.names.en}`, exact: true })
    .click();
  const details = page.locator('#definition-powder-laundry-detergent');
  await expect(details).toContainText('2000-01');
  await expect(details).toContainText('1.2');
  await page.getByRole('button', { name: 'Close product details', exact: true }).click();
  await page.locator('#end-latest').click();
  await expect(page.getByTestId('latest-cost')).toHaveText('—');
  await page.reload();
  await expect(page.locator('#qty-powder-laundry-detergent')).toBeVisible();
  await expect(page.locator('#qty-liquid-laundry-detergent')).toHaveCount(0);
  await page.getByRole('button', { name: '日本語', exact: true }).click();
  await expect(page.locator('.quality-summary')).toContainText('この商品形態');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('historical city areas are explicit separate selections, with no predecessor price in the current city', async ({
  page,
}) => {
  const release = await load(page);
  const historical = release.cities.find(
    (city) => city.historical && city.names.en.includes('Shizuoka'),
  )!;
  expect(historical).toBeDefined();
  const current = release.cities.find((city) => !city.historical && city.names.en === 'Shizuoka')!;
  await page.locator('#city').selectOption(current.id);
  await selectMonth(page, 'end', '2000-01');
  await expect(page.getByTestId('latest-cost')).toHaveText('—');
  await page.locator('#city').selectOption(historical.id);
  await expect(page.getByTestId('latest-cost')).not.toHaveText('—');
  await page.locator('#end-latest').click();
  await expect(page.getByTestId('latest-cost')).toHaveText('—');
  await expect(page.locator('.quality-summary')).toContainText(historical.end);
  await page.reload();
  await expect(page.locator('#city')).toHaveValue(historical.id);
  await page.getByRole('button', { name: '日本語', exact: true }).click();
  await expect(page.locator('#city option:checked')).toHaveText(historical.names.ja);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('city coverage explains both gaps and confines them to the selected window', async ({
  page,
}) => {
  const release = await load(page);
  const historical = release.cities.find(
    (city) => city.historical && city.names.en.includes('Ishinomaki'),
  )!;
  await page.locator('#city').selectOption(historical.id);
  const quality = page.locator('.quality-summary');
  await quality.locator('summary').click();
  await expect(quality).toContainText('2000-01 – 2008-12');
  await expect(quality).toContainText('2020-01 – 2026-08');
  await selectMonth(page, 'end', '2000-01');
  await expect(quality).toContainText('2000-01 – 2000-01');
  await expect(quality).not.toContainText('2008-12');
  await expect(quality).not.toContainText('2020-01 –');
  await page.getByRole('button', { name: '日本語', exact: true }).click();
  await expect(quality).toContainText('2000-01 – 2000-01');
});
