import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { expectRange } from './helpers/dates';

const storageKey = 'japan-basket-prices:v1';
const starterQuantities = [
  ['koshihikari-rice', '5', 'kg'],
  ['white-bread', '1.5', 'kg'],
  ['domestic-pork', '2', 'kg'],
  ['chicken-thigh', '1.5', 'kg'],
  ['tuna', '150', 'g'],
  ['momen-tofu', '2', 'kg'],
  ['mixed-size-eggs', '40', 'count'],
  ['carton-milk', '6', 'L'],
  ['cabbage', '1.25', 'kg'],
  ['onions', '1.2', 'kg'],
  ['potatoes', '700', 'g'],
  ['carrots', '600', 'g'],
  ['bananas', '1.5', 'kg'],
  ['cooking-oil', '600', 'g'],
  ['soy-sauce', '300', 'mL'],
  ['miso', '400', 'g'],
];

async function load(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('latest-cost')).toHaveText('¥20,746');
}

async function expectStarter(page: Page) {
  await expect(page.locator('.basket-row')).toHaveCount(16);
  for (const [id, quantity, unit] of starterQuantities) {
    await expect(page.locator(`#qty-${id}`)).toHaveValue(quantity);
    await expect(page.locator(`#unit-${id}`)).toHaveValue(unit);
  }
}

async function seedOldStarter(page: Page, breadQuantity = '1') {
  await page.addInitScript(
    ({ key, bread }) => {
      if (localStorage.getItem(key) !== null) return;
      const basket = {
        schemaVersion: 1,
        name: 'Staples / 基本食材',
        cityId: '13100',
        start: '2000-01',
        end: '2026-08',
        items: ['white-bread', 'white-sugar', 'cabbage', 'potatoes', 'carrots'].map(
          (productId, index) => ({
            productId,
            quantity: index === 0 ? bread : '1',
            unit: 'kg',
          }),
        ),
      };
      localStorage.setItem(
        key,
        JSON.stringify({
          schemaVersion: 1,
          releaseId: 'previous',
          locale: 'en',
          observedOnly: false,
          endMode: 'latest',
          current: basket,
          saved: [{ ...basket, name: 'Saved staples' }],
        }),
      );
    },
    { key: storageKey, bread: breadQuantity },
  );
}

test('fresh starter includes rice and everyday foods with bilingual reporting disclosure and keyboard charts', async ({
  page,
  context,
}, info) => {
  const errors: string[] = [],
    outsideRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4173/')) outsideRequests.push(request.url());
  });
  await load(page);
  await expectStarter(page);
  await expect(page.locator('#city')).toHaveValue('13100');
  await expectRange(page, '2000-01', '2026-08');
  await expect(page.locator('#end-latest')).toHaveAttribute('aria-pressed', 'true');
  if (info.project.name === 'chromium') await page.setViewportSize({ width: 1366, height: 768 });
  await mkdir('tmp/default-preview', { recursive: true });

  for (const language of ['English', '日本語']) {
    const locale = language === 'English' ? 'en' : 'ja';
    await page.getByRole('button', { name: language, exact: true }).click();
    const chart = page.locator('.price-chart');
    await chart.focus();
    await chart.press('Home');
    await expect(page.getByTestId('chart-tooltip')).toContainText('2000-01');
    await expect(page.getByTestId('chart-tooltip')).toContainText(/15,064/);
    await chart.press('End');
    await expect(page.getByTestId('chart-tooltip')).toContainText('2026-08');
    await expect(page.getByTestId('chart-tooltip')).toContainText(/20,746/);
    await chart.press('Escape');
    await expect(page.getByTestId('chart-tooltip')).toBeHidden();
    await expect(chart).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (info.project.name === 'chromium')
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(
        true,
      );
    await page.screenshot({
      path: `tmp/default-preview/${info.project.name}-${locale}.png`,
      fullPage: true,
    });
    await page
      .getByRole('button', { name: language === 'English' ? 'Data source' : '出典', exact: true })
      .click();
    const source = page.locator('#source-information');
    await expect(source).toBeVisible();
    await expect(source).toContainText(language === 'English' ? 'two or more people' : '二人以上');
    await expect(source).toContainText(language === 'English' ? 'tofu' : '豆腐');
    await expect(source).toContainText(language === 'English' ? '60 g' : '60g');
    const bounds = await source.boundingBox();
    const viewport = page.viewportSize()!;
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    await expect(
      source.getByRole('link', {
        name: language === 'English' ? /2025 household purchases/ : /2025年の世帯購入量/,
      }),
    ).toHaveAttribute(
      'href',
      'https://www.e-stat.go.jp/stat-search/files?layout=dataset&stat_infid=000040424635',
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `tmp/default-preview/${info.project.name}-${locale}-source.png`,
      fullPage: true,
    });
    await page.keyboard.press('Escape');
    await expect(source).not.toBeVisible();
  }
  expect(await context.cookies()).toEqual([]);
  expect(outsideRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('rice edits update the live graph, survive reload and reset restores every starter quantity', async ({
  page,
}) => {
  await load(page);
  const before = await page.locator('.price-chart').innerHTML();
  await page.locator('#qty-koshihikari-rice').fill('1');
  // August 2026 rice is 4,326 yen per 5 kg; removing 4 kg removes 3,460.8 yen.
  await expect(page.getByTestId('latest-cost')).toHaveText('¥17,285');
  await expect.poll(() => page.locator('.price-chart').innerHTML()).not.toBe(before);
  await page.reload();
  await expect(page.locator('#qty-koshihikari-rice')).toHaveValue('1');
  await expect(page.getByTestId('latest-cost')).toHaveText('¥17,285');
  await page.getByRole('button', { name: 'Reset basket', exact: true }).click();
  await expectStarter(page);
  await expect(page.getByTestId('latest-cost')).toHaveText('¥20,746');
});

test('untouched earlier starter upgrades with a notice while preserving its named saved basket', async ({
  page,
}) => {
  await seedOldStarter(page);
  await load(page);
  await expectStarter(page);
  await expect(
    page.getByText('The starter basket now includes rice', { exact: false }),
  ).toBeVisible();
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!).saved,
    storageKey,
  );
  expect(saved).toHaveLength(1);
  expect(saved[0].name).toBe('Saved staples');
  expect(saved[0].items).toHaveLength(5);
  expect(saved[0].items[0]).toEqual({ productId: 'white-bread', quantity: '1', unit: 'kg' });
});

test('a customized earlier starter keeps the visitor quantities and goods', async ({ page }) => {
  await seedOldStarter(page, '1.5');
  await page.goto('/');
  await expect(page.getByTestId('latest-cost')).toHaveText('¥2,381');
  await expect(page.locator('.basket-row')).toHaveCount(5);
  await expect(page.locator('#qty-white-bread')).toHaveValue('1.5');
  await expect(page.locator('#qty-koshihikari-rice')).toHaveCount(0);
  await expect(
    page.getByText('The starter basket now includes rice', { exact: false }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.basket-row')).toHaveCount(5);
  await expect(page.locator('#qty-white-bread')).toHaveValue('1.5');
});

test('reset in a city with interrupted food coverage preserves all goods and explains its usable dates', async ({
  page,
}) => {
  await load(page);
  await page.getByRole('button', { name: 'Clear basket', exact: true }).click();
  await page.locator('#city').selectOption('23201');
  await expect(page.locator('#city')).toHaveValue('23201');
  await expect(page.getByTestId('compatibility-notice')).toContainText(
    'Dates adjusted to this city’s published coverage:',
  );
  await page.getByRole('button', { name: 'Reset basket', exact: true }).click();
  await expectStarter(page);
  await expectRange(page, '2025-01', '2026-08');
  await expect(page.getByTestId('compatibility-notice')).toContainText(
    'The complete starter basket is available for:',
  );
  await expect(page.getByTestId('compatibility-notice')).toContainText('2025-01 – 2026-08');
  await expect(page.getByTestId('latest-cost')).not.toHaveText('—');
  await expect(page.locator('.price-chart')).toBeVisible();
});
