import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function load(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('latest-cost')).toHaveText('¥2,098');
}
async function add(page: Page, query: string, name: RegExp) {
  await page.locator('#search').fill(query);
  await page.getByRole('option', { name }).click();
}

test('one basket recalculates charts immediately and persists without a save step or cookies', async ({
  page,
  context,
}) => {
  const errors: string[] = [],
    requests: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (!r.url().startsWith('http://127.0.0.1:4173/')) requests.push(r.url());
  });
  await load(page);
  await expect(page.locator('#city option')).toHaveCount(81);
  await expect(page.locator('#start')).toHaveValue('2024-09');
  await expect(page.locator('#end')).toHaveValue('2026-08');
  const before = await page.locator('.price-chart').innerHTML();
  await page.locator('#qty-white-bread').fill('0.5');
  await expect(page.getByTestId('latest-cost')).toHaveText('¥1,815');
  expect(await page.locator('.price-chart').innerHTML()).not.toBe(before);
  await add(page, 'たまねぎ', /^Add: Onions/);
  await page.locator('#qty-onions').fill('0.5');
  await page.locator('#unit-onions').selectOption('g');
  await expect(page.locator('#qty-onions')).toHaveValue('500');
  await page.getByRole('button', { name: '日本語', exact: true }).click();
  await page.locator('#start').selectOption('2025-10');
  await page.reload();
  await expect(page.locator('#qty-onions')).toHaveValue('500');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(page.locator('#start')).toHaveValue('2025-10');
  await expect(page.locator('.price-chart')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save named basket' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'How to read these results' })).toHaveCount(0);
  await expect(page.locator('footer')).toHaveCount(0);
  await expect(page.locator('input[type=file]')).toHaveCount(0);
  expect(await context.cookies()).toEqual([]);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

test('search supports keyboard selection, categories, no results and Escape', async ({ page }) => {
  await load(page);
  await page.locator('#search').fill('onion');
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.locator('#search').press('Enter');
  await expect(page.locator('#qty-onions')).toBeVisible();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await page.locator('#search').fill('unfindable-product');
  await expect(page.getByText('No matching reviewed products.', { exact: false })).toBeVisible();
  await page.locator('#search').fill('');
  await page.locator('#category').selectOption('household');
  await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(3);
  await page.locator('#search').focus();
  await page.locator('#search').press('Escape');
  await expect(page.locator('#search')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#search').click();
  await page.getByRole('heading', { level: 1 }).click();
  await expect(page.locator('#search')).toHaveAttribute('aria-expanded', 'false');
});

test('chart tabs share the current basket, show breakdowns and equivalent values, and work by keyboard', async ({
  page,
}) => {
  await load(page);
  await page.getByRole('tab', { name: 'Basket price', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Breakdown', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('.breakdown-row')).toHaveCount(5);
  await expect(page.locator('.breakdown-row').first()).toContainText('¥566');
  await page.locator('#qty-white-bread').fill('0.5');
  await expect(page.locator('.breakdown-row').first()).toContainText('¥283');
  await page.getByRole('tab', { name: 'Product history', exact: true }).click();
  await page.locator('#chart-series').selectOption('carrots');
  await expect(page.locator('.price-chart')).toHaveAttribute('aria-label', /Carrots/);
  await page.getByRole('tab', { name: 'Price index', exact: true }).click();
  await expect(page.locator('.price-chart')).toHaveAttribute('aria-label', /100/);
  await page.getByRole('tab', { name: 'Monthly data', exact: true }).click();
  await expect(page.locator('.monthly-table tbody tr')).toHaveCount(24);
  await expect(page.locator('.monthly-table tbody tr').last()).toContainText('¥1,815');
  await page.getByRole('tab', { name: 'Monthly data', exact: true }).focus();
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Basket price', exact: true })).toBeFocused();
});

test('seasonal prices retain actual anchors and observed-only never drops goods', async ({
  page,
}) => {
  await load(page);
  await page.getByRole('button', { name: 'Clear basket', exact: true }).click();
  await add(page, 'mikan', /^Add: Satsuma/);
  await expect(page.locator('.totals')).toContainText('Estimated');
  await expect(page.locator('.price-chart line[stroke-dasharray]')).not.toHaveCount(0);
  await page.getByRole('tab', { name: 'Monthly data', exact: true }).click();
  await expect(page.locator('.monthly-table tbody tr').last()).toContainText('2026-03');
  await page.getByLabel('Observed prices only', { exact: true }).check();
  await expect(page.getByTestId('latest-cost')).toHaveText('—');
  await expect(page.locator('#qty-satsuma-mandarins')).not.toHaveValue('');
  await page.getByLabel('Observed prices only', { exact: true }).uncheck();
  await expect(page.getByTestId('latest-cost')).not.toHaveText('—');
});

test('real specification breaks split chart lines and block comparisons until baseline moves', async ({
  page,
}) => {
  await load(page);
  await page.getByRole('button', { name: 'Clear basket', exact: true }).click();
  await add(page, 'dish soap', /^Add: Dishwashing/);
  await expect(page.getByTestId('basket-change')).toHaveText('—');
  await expect(page.locator('.quality-summary')).toContainText('Comparison unavailable');
  await expect(page.locator('.price-chart circle')).toHaveCount(24);
  await expect(page.locator('.price-chart line[stroke-width="2.5"]')).toHaveCount(22);
  await page.locator('#start').selectOption('2025-10');
  await expect(page.getByTestId('basket-change')).not.toHaveText('—');
  await page.getByRole('button', { name: 'Full history', exact: true }).click();
  await expect(page.getByTestId('basket-change')).toHaveText('—');
  await page.locator('#city').selectOption('14205');
  await page.getByRole('tab', { name: 'Monthly data', exact: true }).click();
  await expect(page.locator('.monthly-table tbody tr').first()).toContainText('city not surveyed');
});

test('invalid quantities and dates prevent misleading charts while preserving the last valid basket', async ({
  page,
}) => {
  await load(page);
  await page.locator('#qty-white-bread').fill('0');
  await expect(page.locator('#qty-white-bread')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('latest-cost')).toHaveText('—');
  await expect(page.locator('.price-chart')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('japan-basket-prices:v1')!).current.items[0].quantity,
    ),
  ).toBe('1');
  await page.locator('#qty-white-bread').fill('0.5');
  await expect(page.getByTestId('latest-cost')).toHaveText('¥1,815');
  await page.locator('#start').selectOption('2026-08');
  await page.locator('#end').selectOption('2025-09');
  await expect(page.getByRole('alert')).toContainText('baseline');
  await expect(page.getByTestId('latest-cost')).toHaveText('—');
  await page.getByRole('button', { name: 'Full history', exact: true }).click();
  await expect(page.getByTestId('latest-cost')).toHaveText('¥1,815');
});

test('blocked storage and a failed city file preserve the session with retry', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'localStorage', {
      get: () => {
        throw new DOMException('Blocked', 'SecurityError');
      },
    }),
  );
  await load(page);
  await expect(page.getByText('Browser storage is unavailable.', { exact: false })).toBeVisible();
  await page.locator('#qty-white-bread').fill('0.5');
  await expect(page.getByTestId('latest-cost')).toHaveText('¥1,815');
  await page.route('**/cities/01100.json', (r) => r.fulfill({ status: 503, body: 'Unavailable' }));
  await page.locator('#city').selectOption('01100');
  await expect(page.getByRole('alert')).toContainText('bundled data');
  await expect(page.getByTestId('latest-cost')).toHaveText('—');
  await page.unroute('**/cities/01100.json');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.price-chart')).toBeVisible();
  await expect(page.locator('#qty-white-bread')).toHaveValue('0.5');
});

test('corrupt stored data stays intact until Reset basket and old named records stay preserved', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('japan-basket-prices:v1') === null)
      localStorage.setItem('japan-basket-prices:v1', '{broken');
  });
  await load(page);
  await expect(page.getByText('Saved data could not be restored', { exact: false })).toBeVisible();
  await page.locator('#qty-white-bread').fill('0.5');
  expect(await page.evaluate(() => localStorage.getItem('japan-basket-prices:v1'))).toBe('{broken');
  await page.getByRole('button', { name: 'Reset basket', exact: true }).click();
  await expect(page.getByTestId('latest-cost')).toHaveText('¥2,098');
  await page.evaluate(() => {
    const key = 'japan-basket-prices:v1',
      state = JSON.parse(localStorage.getItem(key)!);
    state.saved = [{ ...state.current, name: 'Previous basket' }];
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload();
  await page.locator('#qty-white-bread').fill('0.5');
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('japan-basket-prices:v1')!).saved[0].name,
    ),
  ).toBe('Previous basket');
});

test('unit presets and rapid city switching keep the correct city and quantities', async ({
  page,
}) => {
  await load(page);
  await add(page, 'milk', /^Add: Milk/);
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
  await page.getByRole('tab', { name: 'Monthly data', exact: true }).click();
  await expect(page.locator('table caption')).toContainText('Naha');
  await expect(page.locator('.monthly-table tbody tr')).toHaveCount(24);
});

test('desktop fits its viewport and long basket and data lists scroll inside panels', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await load(page);
  for (const language of ['English', '日本語']) {
    await page.getByRole('button', { name: language, exact: true }).click();
    const box = await page.locator('.price-chart').boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(768);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(
      true,
    );
  }
  await page.getByRole('button', { name: 'English', exact: true }).click();
  const fifth = await page.locator('#qty-carrots').boundingBox();
  expect(fifth!.y + fifth!.height).toBeLessThanOrEqual(768);
  await add(page, 'onions', /^Add: Onions/);
  await add(page, 'rice', /^Add: Koshihikari/);
  expect(await page.locator('.basket-items').evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(
    true,
  );
  await page.getByRole('tab', { name: 'Monthly data', exact: true }).click();
  expect(await page.locator('.table-scroll').evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(
    true,
  );
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(
    true,
  );
});

test('bilingual layouts reflow at narrow widths, large text and reduced motion', async ({
  page,
}, info) => {
  await load(page);
  for (const language of ['English', '日本語']) {
    await page.getByRole('button', { name: language, exact: true }).click();
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.screenshot({
    path: `test-results/${info.project.name}-live-ja-mobile.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.screenshot({ path: `test-results/${info.project.name}-live-en-desktop.png` });
  await page.setViewportSize({ width: 768, height: 900 });
  await page.addStyleTag({ content: ':root { font-size: 200%; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#search').focus();
  expect(
    await page.locator('.search-input').evaluate((el) => getComputedStyle(el).outlineStyle),
  ).not.toBe('none');
});

test('source disclosure, search and all chart tabs pass automated access checks in both languages', async ({
  page,
}) => {
  await load(page);
  for (const language of ['English', '日本語']) {
    await page.getByRole('button', { name: language, exact: true }).click();
    for (const tab of await page.getByRole('tab').all()) {
      await tab.click();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }
    await page.locator('#search').fill('milk');
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.locator('#search').press('Escape');
    await page
      .getByRole('button', { name: language === 'English' ? 'Data source' : '出典', exact: true })
      .click();
    await expect(page.locator('#source-information')).toBeVisible();
    await expect(page.locator('#source-information')).toContainText(
      language === 'English' ? 'Not a government website' : '政府のウェブサイトではありません',
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.locator('#source-information')).not.toBeVisible();
    await page
      .getByRole('button', { name: /^(Specification and history|銘柄・履歴):/ })
      .first()
      .click();
    await expect(page.locator('#definition-white-bread')).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.keyboard.press('Escape');
  }
});
