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

test('retired detergents leave the live basket and search while earlier named records stay preserved', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const key = 'japan-basket-prices:v1';
    if (localStorage.getItem(key)) return;
    const basket = {
      schemaVersion: 1,
      name: 'Previous selection',
      cityId: '13100',
      start: '2000-01',
      end: '2026-08',
      items: [
        { productId: 'powder-laundry-detergent', quantity: '1', unit: 'kg' },
        { productId: 'white-bread', quantity: '1', unit: 'kg' },
      ],
    };
    localStorage.setItem(
      key,
      JSON.stringify({
        schemaVersion: 1,
        releaseId: 'previous',
        locale: 'en',
        observedOnly: false,
        current: basket,
        saved: [basket],
      }),
    );
  });
  await page.goto('/');
  await expect(page.getByTestId('latest-cost')).toHaveText('¥566');
  await expect(page.locator('#qty-powder-laundry-detergent')).toHaveCount(0);
  await expect(page.getByText('Detergent products were removed', { exact: false })).toBeVisible();
  await page.locator('#search').fill('laundry detergent');
  await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(0);
  await page.locator('#search').press('Escape');
  await page.reload();
  await expect(page.locator('#qty-white-bread')).toBeVisible();
  await expect(page.locator('#qty-powder-laundry-detergent')).toHaveCount(0);
  await expect(page.locator('#qty-liquid-laundry-detergent')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('japan-basket-prices:v1')!).saved[0].items[0].productId,
    ),
  ).toBe('powder-laundry-detergent');
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
  await expectRange(page, current.start, '2026-08');
  await expect(page.getByTestId('latest-cost')).not.toHaveText('—');
  await selectMonth(page, 'start', '2000-01');
  await expectRange(page, current.start, '2026-08');
  await expect(page.getByTestId('compatibility-notice')).toContainText('Dates unchanged');
  await page.locator('#city').selectOption(historical.id);
  await expectRange(page, historical.end, historical.end);
  await expect(page.getByTestId('latest-cost')).not.toHaveText('—');
  await page.locator('#end-latest').click();
  await expectRange(page, historical.end, historical.end);
  await expect(page.getByTestId('compatibility-notice')).toContainText('Dates unchanged');
  await page.reload();
  await expect(page.locator('#city')).toHaveValue(historical.id);
  await page.getByRole('button', { name: '日本語', exact: true }).click();
  await expect(page.locator('#city option:checked')).toHaveText(historical.names.ja);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('unified eggs use labeled estimates in January 2000 without offering separate size forms', async ({
  page,
}) => {
  await load(page);
  await page.getByRole('button', { name: 'Clear basket', exact: true }).click();
  await page.locator('#search').fill('eggs');
  await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(1);
  await page.locator('#search').press('Enter');
  await expect(page.locator('#qty-mixed-size-eggs')).toBeVisible();
  const chart = page.locator('.price-chart');
  await chart.focus();
  await chart.press('Home');
  await expect(page.getByTestId('chart-tooltip')).toContainText('2000-01');
  await expect(page.getByTestId('chart-tooltip')).toContainText('Estimated');
  await expect(page.getByTestId('chart-tooltip')).toContainText('quantity conversion');
  await expect(page.getByTestId('basket-change')).not.toHaveText('—');
  await page.getByRole('button', { name: /^Specification and history: Eggs/ }).click();
  await expect(page.locator('#definition-mixed-size-eggs')).toContainText(/60\s*g/);
  await page.getByRole('button', { name: 'Close product details', exact: true }).click();
  await page.reload();
  await expect(page.locator('#qty-mixed-size-eggs')).toBeVisible();
  await expect(page.locator('#qty-large-size-eggs')).toHaveCount(0);
});

test('saved rice now compares across reviewed packaging changes while preserving its quantity', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const key = 'japan-basket-prices:v1';
    if (localStorage.getItem(key)) return;
    localStorage.setItem(
      key,
      JSON.stringify({
        schemaVersion: 1,
        releaseId: 'previous',
        locale: 'en',
        observedOnly: false,
        saved: [],
        current: {
          schemaVersion: 1,
          name: 'Old rice',
          cityId: '13100',
          start: '2000-01',
          end: '2026-08',
          items: [{ productId: 'koshihikari-rice', quantity: '1', unit: 'kg' }],
        },
      }),
    );
  });
  await page.goto('/');
  await expect(page.locator('#qty-koshihikari-rice')).toHaveValue('1');
  await expect(page.getByTestId('basket-change')).not.toHaveText('—');
  const chart = page.locator('.price-chart');
  await chart.focus();
  await chart.press('Home');
  await expect(page.getByTestId('chart-tooltip')).toContainText('¥592');
  await selectMonth(page, 'start', '2010-01');
  await expect(page.getByTestId('basket-change')).not.toHaveText('—');
  await page.reload();
  await expect(page.locator('#qty-koshihikari-rice')).toHaveValue('1');
  await expectRange(page, '2010-01', '2026-08');
});

test('saved egg weight becomes an explicit estimated count until the visitor enters a count', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const key = 'japan-basket-prices:v1';
    if (localStorage.getItem(key)) return;
    localStorage.setItem(
      key,
      JSON.stringify({
        schemaVersion: 1,
        releaseId: 'previous',
        locale: 'en',
        observedOnly: false,
        saved: [],
        current: {
          schemaVersion: 1,
          name: 'Weighted eggs',
          cityId: '13100',
          start: '2026-01',
          end: '2026-08',
          items: [{ productId: 'eggs-by-weight', quantity: '180', unit: 'g' }],
        },
      }),
    );
  });
  await page.goto('/');
  await expect(page.locator('#qty-mixed-size-eggs')).toHaveValue('3');
  await expect(page.locator('.basket-row')).toContainText('Egg quantity estimated from weight');
  await expect(page.locator('.totals')).toContainText('Estimated');
  await page.reload();
  await expect(page.locator('#qty-mixed-size-eggs')).toHaveValue('3');
  await expect(page.locator('.basket-row')).toContainText('60 g per egg');
  await page.locator('#qty-mixed-size-eggs').fill('6');
  await expect(page.locator('.basket-row')).not.toContainText('Egg quantity estimated from weight');
  await expect(page.locator('.totals')).not.toContainText('Estimated');
  await page.reload();
  await expect(page.locator('#qty-mixed-size-eggs')).toHaveValue('6');
  await expect(page.locator('.basket-row')).not.toContainText('Egg quantity estimated from weight');
});

test('an unusable city is rejected without dropping the selected product or losing its graph', async ({
  page,
}) => {
  await load(page);
  await selectMonth(page, 'start', '2024-09');
  await page.getByRole('button', { name: 'Clear basket', exact: true }).click();
  await page.locator('#search').fill('broccoli');
  await page.locator('#search').press('Enter');
  await expect(page.locator('#qty-broccoli')).toBeVisible();
  const before = await page.getByTestId('latest-cost').textContent();
  await page.locator('#city').selectOption('01202');
  await expect(page.getByTestId('compatibility-notice')).toContainText('City unchanged');
  await expect(page.locator('#city')).toHaveValue('13100');
  await expect(page.getByTestId('latest-cost')).toHaveText(before!);
  await expect(page.locator('#qty-broccoli')).toBeVisible();
  await page.reload();
  await expect(page.locator('#city')).toHaveValue('13100');
});

test('restored incompatible city coverage explains both gaps and confines them to the saved window', async ({
  page,
}) => {
  const release = await load(page);
  const historical = release.cities.find(
    (city) => city.historical && city.names.en.includes('Ishinomaki'),
  )!;
  await page.evaluate((cityId) => {
    const key = 'japan-basket-prices:v1';
    const state = JSON.parse(localStorage.getItem(key)!);
    state.current.cityId = cityId;
    state.endMode = 'fixed';
    localStorage.setItem(key, JSON.stringify(state));
  }, historical.id);
  await page.reload();
  await expect(page.locator('#city')).toHaveValue(historical.id);
  const quality = page.locator('.quality-summary');
  await quality.locator('summary').click();
  await expect(quality).toContainText('2000-01 – 2008-12');
  await expect(quality).toContainText('2020-01 – 2026-08');
  await page.evaluate(() => {
    const key = 'japan-basket-prices:v1';
    const state = JSON.parse(localStorage.getItem(key)!);
    state.current.end = '2000-01';
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload();
  await quality.locator('summary').click();
  await expect(quality).toContainText('2000-01 – 2000-01');
  await expect(quality).not.toContainText('2008-12');
  await expect(quality).not.toContainText('2020-01 –');
  await page.getByRole('button', { name: '日本語', exact: true }).click();
  await expect(quality).toContainText('2000-01 – 2000-01');
});
