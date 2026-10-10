import { expect, test, type Page } from '@playwright/test';
import {
  MAX_BASKET_ITEMS,
  type Basket,
  type CityData,
  type Release,
} from '../../packages/domain/src/contracts';
import { productEligibility } from '../../packages/domain/src/domain';
import { selectMonth } from './helpers/dates';

async function dataset(page: Page) {
  const pointer = await (await page.request.get('/data/current.json')).json();
  const release: Release = await (await page.request.get(`/data/${pointer.manifest}`)).json();
  return release;
}

async function seed(
  page: Page,
  release: Release,
  options: {
    items?: Basket['items'];
    oldRelease?: boolean;
    start?: string;
    end?: string;
    endMode?: 'fixed' | 'latest';
  } = {},
) {
  const basket: Basket = {
    schemaVersion: 1,
    name: 'Search and release regression',
    cityId: '13100',
    start: options.start ?? '2024-01',
    end: options.end ?? release.end,
    items: options.items ?? [{ productId: 'white-bread', quantity: '0.5', unit: 'kg' }],
  };
  await page.addInitScript(
    ({ releaseId, releaseEnd, current, oldRelease, endMode }) => {
      const key = 'japan-basket-prices:v1';
      if (localStorage.getItem(key)) return;
      localStorage.setItem(
        key,
        JSON.stringify({
          schemaVersion: 1,
          releaseId: oldRelease ? 'previous-review-for-test' : releaseId,
          releaseEnd: oldRelease ? '2026-07' : releaseEnd,
          locale: 'en',
          observedOnly: false,
          endMode,
          current,
          saved: [{ ...current, name: 'Preserved named basket' }],
        }),
      );
    },
    {
      releaseId: release.releaseId,
      releaseEnd: release.end,
      current: basket,
      oldRelease: options.oldRelease ?? false,
      endMode: options.endMode ?? 'fixed',
    },
  );
  await page.goto('/');
  await expect(page.locator('#search')).toBeEnabled();
  return basket;
}

test('English source brands and kana readings find honest generic products in the applicable period', async ({
  page,
}) => {
  const release = await dataset(page);
  await seed(page, release);
  const search = page.locator('#search');
  await search.fill('Yamasa');
  await expect(
    page.getByRole('option', { name: 'Add: Men-tsuyu noodle sauce', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('option', { name: 'Add: Soy sauce', exact: true })).toHaveCount(0);
  await search.fill('Kikkoman');
  await expect(page.getByRole('option', { name: 'Add: Soy sauce', exact: true })).toBeVisible();
  await expect(
    page.getByRole('option', { name: 'Add: Men-tsuyu noodle sauce', exact: true }),
  ).toHaveCount(0);
  await search.fill('Kewpie');
  await expect(page.getByRole('option', { name: 'Add: Mayonnaise', exact: true })).toBeVisible();
  await expect(
    page.getByRole('option', { name: 'Add: Sesame dressing', exact: true }),
  ).toBeVisible();
  await search.fill('ギュウニュウ');
  await expect(
    page.getByRole('option', { name: 'Add: Milk · 1 L carton', exact: true }),
  ).toBeVisible();
  await search.fill('ｷﾞｭｳﾆｭｳ');
  await search.press('Enter');
  await expect(page.locator('#qty-carton-milk')).toBeVisible();
  await page.getByRole('button', { name: '日本語', exact: true }).click();
  await search.fill('Kewpie');
  await expect(page.getByRole('option', { name: '追加: マヨネーズ', exact: true })).toBeVisible();
  await search.press('Escape');
});

test('changing the period refreshes the dated source brand matches', async ({ page }) => {
  const release = await dataset(page);
  await seed(page, release, { start: '2023-01', end: '2023-12' });
  await page.locator('#search').fill('Yamasa');
  await expect(page.getByRole('option', { name: 'Add: Soy sauce', exact: true })).toBeVisible();
  await page.locator('#search').press('Escape');
  await selectMonth(page, 'end', '2024-12');
  await selectMonth(page, 'start', '2024-01');
  // Reopen the existing query after leaving search to change the dates.
  await page.locator('#search').click();
  await page.locator('#search').fill('Yamasa');
  await expect(page.getByRole('option', { name: 'Add: Soy sauce', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('option', { name: 'Add: Men-tsuyu noodle sauce', exact: true }),
  ).toBeVisible();
});

test('a seasonal result identifies its last actual quote without claiming a current price', async ({
  page,
}) => {
  const release = await dataset(page);
  await seed(page, release);
  await page.locator('#search').fill('satsuma');
  const result = page.getByRole('option', {
    name: 'Add: Satsuma mandarins · seasonal',
    exact: true,
  });
  await expect(result).toBeVisible();
  await expect(result).toContainText('Seasonal');
  await expect(result).toContainText('Last survey quote: 2026-03');
  await expect(result).not.toContainText('¥');
  await page.getByRole('button', { name: '日本語', exact: true }).click();
  await page.locator('#search').fill('satsuma');
  const japanese = page.getByRole('option', { name: '追加: 温州みかん（季節品）', exact: true });
  await expect(japanese).toContainText('直近の実測月: 2026-03');
});

test('the basket limit blocks mouse and keyboard adds until a row is removed', async ({ page }) => {
  const release = await dataset(page);
  const record = release.cities.find((c) => c.id === '13100')!;
  const city: CityData = await (
    await page.request.get(`/data/${release.releaseId}/${record.file}`)
  ).json();
  const eligible = release.products.filter(
    (product) =>
      product.id !== 'soy-sauce' &&
      product.selectable !== false &&
      productEligibility(product, city.series[product.id] ?? [], release.end, release.end, false)
        .eligible,
  );
  expect(eligible.length).toBeGreaterThanOrEqual(MAX_BASKET_ITEMS);
  const items = eligible
    .slice(0, MAX_BASKET_ITEMS)
    .map((p) => ({ productId: p.id, quantity: '1', unit: p.unit }));
  await seed(page, release, { start: release.end, items });
  await page.locator('#search').fill('Kikkoman');
  const candidate = page.getByRole('option', { name: 'Add: Soy sauce', exact: true });
  await expect(candidate).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('status').filter({ hasText: 'Basket limit reached' })).toBeVisible();
  // aria-disabled communicates the cap; still verify the application rejects a pointer event.
  await candidate.click({ force: true });
  await page.locator('#search').press('Enter');
  await expect(page.locator('#qty-soy-sauce')).toHaveCount(0);
  await expect(page.locator('.basket-row')).toHaveCount(MAX_BASKET_ITEMS);
  await page.locator('#search').press('Escape');
  await page
    .locator(`#qty-${items[0].productId}`)
    .locator('xpath=ancestor::div[contains(@class,"basket-row")]')
    .getByRole('button', { name: /^Remove:/ })
    .click();
  await page.locator('#search').fill('Kikkoman');
  await expect(candidate).toHaveAttribute('aria-disabled', 'false');
  await candidate.click();
  await expect(page.locator('#qty-soy-sauce')).toBeVisible();
  await expect(page.locator('.basket-row')).toHaveCount(MAX_BASKET_ITEMS);
  await page.reload();
  await expect(page.locator('#qty-soy-sauce')).toBeVisible();
  await expect(page.locator('.basket-row')).toHaveCount(MAX_BASKET_ITEMS);
});

test('a changed release remains announced through opening and reload, until explicit acknowledgment', async ({
  page,
}) => {
  const release = await dataset(page);
  const basket = await seed(page, release, { oldRelease: true, end: '2026-07', endMode: 'latest' });
  const source = page.getByRole('button', { name: 'Data source', exact: true });
  await expect(source).toContainText('New data');
  await source.click();
  await expect(page.getByRole('button', { name: 'Acknowledge update', exact: true })).toBeVisible();
  await expect(page.locator('#source-information')).toContainText('previous-review-for-test');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('#search')).toBeEnabled();
  await expect(source).toContainText('New data');
  const persisted = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('japan-basket-prices:v1')!),
  );
  expect(persisted.current).toEqual({ ...basket, end: release.end });
  expect(persisted.saved[0]).toEqual({ ...basket, name: 'Preserved named basket' });
  expect(persisted.pendingReleaseNotice.advancedLatest).toBe(true);
  await source.click();
  await page.getByRole('button', { name: 'Acknowledge update', exact: true }).click();
  await expect(source).not.toContainText('New data');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('#search')).toBeEnabled();
  await expect(source).not.toContainText('New data');
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('japan-basket-prices:v1')!).pendingReleaseNotice,
    ),
  ).toBeUndefined();
});
