import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seedAuditedBasket } from './helpers/auditedBasket';
import { selectMonth } from './helpers/dates';

const chartTabs = [
  { en: 'Basket price', ja: 'かごの価格' },
  { en: 'Breakdown', ja: '内訳' },
  { en: 'Product history', ja: '商品の推移' },
  { en: 'Price index', ja: '価格指数' },
  { en: 'Monthly data', ja: '月次データ' },
] as const;

// Each audit has a fresh page and the normal test deadline. Combining all eight
// scans in one test exhausted that deadline on the shared CI runner.
for (const locale of ['en', 'ja'] as const) {
  const english = locale === 'en';
  const language = english ? 'English' : '日本語';

  test.describe(`automated accessibility in ${language}`, () => {
    test.beforeEach(async ({ page }) => {
      await seedAuditedBasket(page);
      await page.goto('/');
      await expect(page.getByTestId('latest-cost')).toHaveText('¥2,098');
      await selectMonth(page, 'start', '2024-09');
      await page.getByRole('button', { name: language, exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
    });

    for (const tab of chartTabs) {
      test(`${tab[locale]} chart tab`, async ({ page }) => {
        await expect(page.getByRole('tab')).toHaveCount(chartTabs.length);
        const selected = page.getByRole('tab', { name: tab[locale], exact: true });
        await selected.click();
        await expect(selected).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByRole('tabpanel')).toBeVisible();
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      });
    }

    test('product search results', async ({ page }) => {
      await page
        .getByRole('tab', { name: english ? 'Monthly data' : '月次データ', exact: true })
        .click();
      await page.locator('#search').fill('milk');
      await expect(page.getByRole('listbox')).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.locator('#search').press('Escape');
      await expect(page.getByRole('listbox')).not.toBeVisible();
    });

    test('source disclosure and narrow-screen bounds', async ({ page }, info) => {
      await page
        .getByRole('button', { name: english ? 'Data source' : '出典', exact: true })
        .click();
      const source = page.locator('#source-information');
      await expect(source).toBeVisible();
      await expect(source).toContainText(
        english ? 'Not a government website' : '政府のウェブサイトではありません',
      );
      await expect(source).toContainText(
        english
          ? 'does not remove quality differences'
          : '品質の違いや包装サイズによる単価差の影響は残ります',
      );
      await expect(source).toContainText(
        english ? 'not seasonal adjustment' : '季節調整ではありません',
      );
      const bounds = await source.boundingBox();
      const viewport = page.viewportSize()!;
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
      await page.screenshot({
        path: `test-results/${info.project.name}-policy-source-${locale}.png`,
      });
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(source).not.toBeVisible();
    });

    test('product specification dialog', async ({ page }) => {
      await page
        .getByRole('button', { name: /^(Specification and history|銘柄・履歴):/ })
        .first()
        .click();
      const definition = page.locator('#definition-white-bread');
      await expect(definition).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(definition).not.toBeVisible();
    });
  });
}
