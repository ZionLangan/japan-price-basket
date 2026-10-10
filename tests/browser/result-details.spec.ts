import { expect, test, type Page } from '@playwright/test';
import { seedAuditedBasket } from './helpers/auditedBasket';

async function loadAudited(page: Page) {
  await seedAuditedBasket(page);
  await page.goto('/');
  await expect(page.getByTestId('latest-cost')).toHaveText('¥2,098');
}

test('index inspection identifies an estimated baseline without relabeling observed current item prices', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('latest-cost')).toHaveText('¥20,746');
  await page.getByRole('tab', { name: 'Price index', exact: true }).click();
  await page.locator('.price-chart').focus();
  await page.locator('.price-chart').press('Home');
  await expect(page.getByTestId('chart-price-counts')).toContainText('15 observed');
  await expect(page.getByTestId('chart-price-counts')).toContainText('1 estimated');
  await page.locator('.price-chart').press('End');
  await expect(page.getByTestId('chart-tooltip').locator('.chart-status')).toHaveText('Estimated');
  await expect(page.getByTestId('chart-price-counts')).toContainText('16 observed');
  await expect(page.getByTestId('chart-price-counts')).toContainText('0 estimated');
  await expect(page.getByTestId('chart-tooltip')).toContainText(
    'This comparison includes an estimated endpoint.',
  );
  await page.getByRole('tab', { name: 'Monthly data', exact: true }).click();
  await expect(page.locator('.monthly-table tbody tr').last()).toContainText('137.7');
  await expect(page.locator('.monthly-table tbody tr').last()).toContainText(
    'This comparison includes an estimated endpoint.',
  );
});

test('stationary inspector shows a total yen change and actual estimated item counts', async ({
  page,
}) => {
  await loadAudited(page);
  const chart = page.locator('.price-chart');
  await chart.focus();
  await chart.press('End');
  await expect(page.getByTestId('chart-tooltip')).toContainText('+¥747');
  await expect(page.getByTestId('chart-price-counts')).toContainText('5 observed');
  await expect(page.getByTestId('chart-price-counts')).toContainText('0 estimated');
  await chart.press('Home');
  await expect(page.getByTestId('chart-tooltip')).toContainText('¥1,351');
  await expect(page.getByTestId('chart-tooltip')).toContainText('¥0');
  await page.getByRole('button', { name: 'Clear basket', exact: true }).click();
  await page.locator('#search').fill('strawberries');
  await page.getByRole('option', { name: /^Add: Strawberries/ }).click();
  await chart.focus();
  await chart.press('Home');
  for (let i = 0; i < 5; i++) await chart.press('ArrowRight');
  await expect(page.getByTestId('chart-tooltip')).toContainText('2000-06');
  await expect(page.getByTestId('chart-price-counts')).toContainText('0 observed');
  await expect(page.getByTestId('chart-price-counts')).toContainText('1 estimated');
  await expect(page.getByTestId('chart-tooltip')).toContainText('2000-05');
});

test('Monthly data follows product chart context and includes its fixed quantity, index and yen delta', async ({
  page,
}) => {
  await loadAudited(page);
  await page.getByRole('tab', { name: 'Product history', exact: true }).click();
  await page.locator('#chart-series').selectOption('white-bread');
  await page.locator('.price-chart').focus();
  await page.locator('.price-chart').press('End');
  await expect(page.getByTestId('chart-tooltip')).toContainText('¥566');
  await expect(page.getByTestId('chart-tooltip')).toContainText('+¥144');
  await page.getByRole('tab', { name: 'Monthly data', exact: true }).click();
  await expect(page.locator('#table-series')).toHaveValue('white-bread');
  await expect(page.locator('.monthly-table caption')).toContainText('White bread · 1 kg');
  await expect(page.locator('.monthly-table tbody tr')).toHaveCount(320);
  await expect(page.locator('.monthly-table tbody tr').last()).toContainText('¥566');
  await expect(page.locator('.monthly-table tbody tr').last()).toContainText('+¥144');
  await expect(page.locator('.monthly-table tbody tr').last()).toContainText('134.1');
  await page.locator('#table-series').selectOption('cabbage');
  await expect(page.locator('.monthly-table caption')).toContainText('Cabbage · 1 kg');
  await expect(page.locator('.monthly-table tbody tr').last()).toContainText('+¥64');
  await page.getByRole('tab', { name: 'Price index', exact: true }).click();
  await page.locator('.price-chart').focus();
  await page.locator('.price-chart').press('End');
  await expect(page.getByTestId('chart-tooltip')).toContainText('155.3');
  await page.getByRole('tab', { name: 'Monthly data', exact: true }).click();
  await expect(page.locator('#table-series')).toHaveValue('basket');
  await expect(page.locator('.monthly-table tbody tr').last()).toContainText('¥2,098');
  await expect(page.locator('.monthly-table tbody tr').last()).toContainText('+¥747');
  await expect(page.locator('.monthly-table tbody tr').last()).toContainText('155.3');
  await page.getByRole('button', { name: '日本語', exact: true }).click();
  await expect(page.locator('#table-series')).toHaveValue('basket');
  await page.locator('#table-series').selectOption('white-bread');
  await expect(page.locator('.monthly-table caption')).toContainText('食パン · 1 kg');
  await expect(page.locator('.monthly-table tbody tr').last()).toContainText('￥566');
  await expect(page.locator('.monthly-table tbody tr').last()).toContainText('+￥144');
  await expect(page.locator('.monthly-table')).toBeVisible();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

test('unavailable baseline keeps yen and index comparisons absent while explaining unavailable goods', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const basket = {
      schemaVersion: 1,
      name: 'Real unavailable historical scope audit',
      cityId: '14205',
      start: '2000-01',
      end: '2026-08',
      items: [{ productId: 'white-bread', quantity: '1', unit: 'kg' }],
    };
    localStorage.setItem(
      'japan-basket-prices:v1',
      JSON.stringify({
        schemaVersion: 1,
        releaseId: 'rps-fixture-context',
        locale: 'en',
        observedOnly: false,
        endMode: 'fixed',
        current: basket,
        saved: [],
      }),
    );
  });
  await page.goto('/');
  await expect(page.locator('.price-chart')).toBeVisible();
  await page.locator('.price-chart').focus();
  await page.locator('.price-chart').press('Home');
  await expect(page.getByTestId('chart-tooltip')).toContainText('Unavailable');
  await expect(page.getByTestId('chart-price-counts')).toContainText('1 unavailable');
  await page.locator('.price-chart').press('End');
  await expect(page.getByTestId('chart-tooltip')).toContainText(
    'The baseline has no usable price.',
  );
  await page.getByRole('tab', { name: 'Price index', exact: true }).click();
  await page.locator('.price-chart').focus();
  await page.locator('.price-chart').press('End');
  await expect(page.getByTestId('chart-tooltip').locator('.chart-status')).toHaveText(
    'Unavailable',
  );
  await page.getByRole('tab', { name: 'Monthly data', exact: true }).click();
  const cells = page.locator('.monthly-table tbody tr').last().locator('td');
  await expect(cells.nth(1)).toHaveText('—');
  await expect(cells.nth(2)).toHaveText('—');
  await expect(cells.nth(3)).toHaveText('—');
});
