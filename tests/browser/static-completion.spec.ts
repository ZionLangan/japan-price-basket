import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  ReleaseSchema,
  CityDataSchema,
  MAX_BASKET_ITEMS,
} from '../../packages/domain/src/contracts';
import { productEligibility } from '../../packages/domain/src/domain';

const pointer = JSON.parse(readFileSync('dist/data/current.json', 'utf8'));
const release = ReleaseSchema.parse(
  JSON.parse(readFileSync(`dist/data/${pointer.manifest}`, 'utf8')),
);
const cityInfo = release.cities.find((city) => city.id === '13100')!;
const city = CityDataSchema.parse(
  JSON.parse(readFileSync(`dist/data/${release.releaseId}/${cityInfo.file}`, 'utf8')),
);
const compatible = release.products.filter(
  (product) =>
    product.selectable !== false &&
    productEligibility(product, city.series[product.id] ?? [], release.end, release.end, false)
      .eligible,
);
const storageKey = 'japan-basket-prices:v1';

test('50-product basket remains savable and removing a product permits another addition', async ({
  page,
}) => {
  const products = compatible.slice(0, MAX_BASKET_ITEMS);
  const candidate = compatible[MAX_BASKET_ITEMS];
  await page.addInitScript(
    ({ key, dataset, end, items }) => {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(
        key,
        JSON.stringify({
          schemaVersion: 1,
          releaseId: dataset,
          locale: 'en',
          observedOnly: false,
          endMode: 'fixed',
          saved: [],
          current: {
            schemaVersion: 1,
            name: 'Real-source basket limit case',
            cityId: '13100',
            start: end,
            end,
            items,
          },
        }),
      );
    },
    {
      key: storageKey,
      dataset: release.releaseId,
      end: release.end,
      items: products.map((product) => ({
        productId: product.id,
        quantity: product.presets[0],
        unit: product.unit,
      })),
    },
  );
  await page.goto('/');
  await expect(page.locator('.basket-row')).toHaveCount(MAX_BASKET_ITEMS);
  await page.locator('#search').fill(candidate.code);
  const suggestion = page.getByRole('option', { name: `Add: ${candidate.names.en}` });
  await expect(suggestion).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('.search-menu')).toContainText('Basket limit reached (50 products)');
  await page.locator('#search').press('Enter');
  await expect(page.locator('.basket-row')).toHaveCount(MAX_BASKET_ITEMS);
  await expect(page.getByText('Browser storage is unavailable.', { exact: false })).toHaveCount(0);
  await page.locator('#search').press('Escape');
  await page.reload();
  await expect(page.locator('.basket-row')).toHaveCount(MAX_BASKET_ITEMS);
  await page
    .locator('.basket-row')
    .first()
    .getByRole('button', { name: /^Remove:/ })
    .click();
  await expect(page.locator('.basket-row')).toHaveCount(MAX_BASKET_ITEMS - 1);
  await page.locator('#search').fill(candidate.code);
  await expect(suggestion).not.toHaveAttribute('aria-disabled', 'true');
  await suggestion.click();
  await expect(page.locator(`#qty-${candidate.id}`)).toBeVisible();
  await expect(page.locator('.basket-row')).toHaveCount(MAX_BASKET_ITEMS);
  await page.reload();
  await expect(page.locator(`#qty-${candidate.id}`)).toBeVisible();
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!).current.items.length,
      storageKey,
    ),
  ).toBe(MAX_BASKET_ITEMS);
});

test('Data source explains the snapshot, methods and dates in both languages with narrow-screen reflow', async ({
  page,
}, info) => {
  await page.goto('/');
  await expect(page.getByTestId('latest-cost')).toHaveText('¥20,746');
  await expect(page.getByTestId('basket-change-yen')).toContainText('+¥5,682');
  await mkdir('tmp/static-completion', { recursive: true });
  for (const language of ['English', '日本語']) {
    const english = language === 'English';
    await page.getByRole('button', { name: language, exact: true }).click();
    await page.getByRole('button', { name: english ? 'Data source' : '出典', exact: true }).click();
    const source = page.locator('#source-information');
    await expect(source.getByTestId('source-latest-month')).toHaveText(
      english ? 'August 2026' : '2026年8月',
    );
    await expect(source.getByTestId('source-download-dates')).toHaveText(
      english
        ? '6 Oct 2026 – 10 Oct 2026 (Japan time)'
        : '2026年10月6日 – 2026年10月10日 (日本時間)',
    );
    await expect(source).toContainText(english ? 'manual import and rebuild' : '手動で取り込み');
    await expect(source).toContainText(
      english ? 'not the current calendar month' : '現在の暦月ではなく',
    );
    await expect(source).toContainText(english ? 'up to 11 months' : '最長11か月');
    await expect(
      source.getByRole('link', {
        name: english
          ? 'How the official Consumer Price Index differs'
          : '公式の消費者物価指数との違い',
      }),
    ).toHaveAttribute(
      'href',
      english
        ? 'https://www.stat.go.jp/english/data/cpi/1585.htm'
        : 'https://www.stat.go.jp/data/cpi/4.html',
    );
    await expect(source.getByRole('heading', { level: 3 })).toHaveCount(6);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `tmp/static-completion/${info.project.name}-${english ? 'en' : 'ja'}-source.png`,
    });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const bounds = await source.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(await source.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await page.keyboard.press('Escape');
    await expect(source).toBeHidden();
    await page.getByRole('button', { name: english ? 'Data source' : '出典', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(source).toBeVisible();
    await source
      .getByRole('button', { name: english ? 'Close data source' : '出典を閉じる' })
      .click();
    await expect(source).toBeHidden();
  }
});
