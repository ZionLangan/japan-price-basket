import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { selectMonth } from './helpers/dates';

async function load(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('latest-cost')).toHaveText('¥2,098');
  await expect(page.locator('.price-chart')).toBeVisible();
  // Keep independent calculation checks on their audited 24-month window.
  await selectMonth(page, 'start', '2024-09');
}

async function addOnly(page: Page, query: string, product: RegExp) {
  await page.getByRole('button', { name: 'Clear basket', exact: true }).click();
  await page.locator('#search').fill(query);
  await page.getByRole('option', { name: product }).click();
  await page.locator('.basket-items input[id^="qty-"]').fill('1');
  await expect(page.locator('.price-chart')).toBeVisible();
}

async function expectCrosshair(page: Page) {
  const crosshair = page.getByTestId('chart-crosshair');
  await expect(crosshair).toHaveCount(1);
  // Playwright's visibility test rejects the zero-width bounding box of a
  // vertical SVG line, although its nonzero stroke is visibly painted.
  const painted = await crosshair.evaluate((element) => {
    const line = element as SVGLineElement;
    const style = getComputedStyle(line);
    return (
      line.getBBox().height > 0 &&
      Number.parseFloat(style.strokeWidth) > 0 &&
      style.stroke !== 'none' &&
      style.visibility === 'visible' &&
      style.display !== 'none'
    );
  });
  expect(painted).toBe(true);
}

async function plotPoint(page: Page, monthIndex: number, verticalFraction = 0.15) {
  const plot = page.getByTestId('chart-hit-area');
  await plot.scrollIntoViewIfNeeded();
  const box = await plot.boundingBox();
  expect(box).not.toBeNull();
  return {
    x: box!.x + (box!.width * monthIndex) / 23,
    y: box!.y + box!.height * verticalFraction,
  };
}

async function hoverMonth(page: Page, monthIndex: number, verticalFraction = 0.15) {
  const point = await plotPoint(page, monthIndex, verticalFraction);
  await page.mouse.move(point.x, point.y);
  await expect(page.getByTestId('chart-tooltip')).toBeVisible();
}

async function tooltipFits(page: Page) {
  const tooltip = await page.getByTestId('chart-tooltip').boundingBox();
  const viewport = page.viewportSize()!;
  expect(tooltip).not.toBeNull();
  expect(tooltip!.x).toBeGreaterThanOrEqual(0);
  expect(tooltip!.x + tooltip!.width).toBeLessThanOrEqual(viewport.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('plot-wide hover selects the nearest month and provides bounded detail without moving the chart', async ({
  page,
}) => {
  await load(page);
  const initial = await page.locator('.price-chart').boundingBox();
  await hoverMonth(page, 0, 0.05);
  const tooltip = page.getByTestId('chart-tooltip');
  await expect(tooltip).toContainText('2024-09');
  await expect(tooltip).toContainText('¥1,991');
  await expect(tooltip).toContainText('Observed');
  await expectCrosshair(page);
  await expect(page.getByTestId('chart-active-point')).toBeVisible();
  await tooltipFits(page);

  // A position near the lower edge still selects by month, rather than requiring
  // a precise hit on the small observation marker.
  await hoverMonth(page, 11.3, 0.95);
  await expect(tooltip).toContainText('2025-08');
  await hoverMonth(page, 23, 0.05);
  await expect(tooltip).toContainText('2026-08');
  await expect(tooltip).toContainText('¥2,098');
  await expect(tooltip).toContainText('5.4%');
  await tooltipFits(page);
  const final = await page.locator('.price-chart').boundingBox();
  expect(final!.width).toBeCloseTo(initial!.width);
  expect(final!.height).toBeCloseTo(initial!.height);
  await tooltip.hover();
  await expect(tooltip).toBeVisible();
  await page.getByRole('heading', { level: 1 }).hover();
  await expect(tooltip).toBeHidden();
});

test('keyboard inspection navigates all months, preserves focus and dismisses with Escape', async ({
  page,
}) => {
  await load(page);
  const chart = page.locator('.price-chart');
  await chart.focus();
  await chart.press('Home');
  const tooltip = page.getByTestId('chart-tooltip');
  await expect(tooltip).toContainText('2024-09');
  await chart.press('ArrowRight');
  await expect(tooltip).toContainText('2024-10');
  await chart.press('ArrowLeft');
  await expect(tooltip).toContainText('2024-09');
  await chart.press('ArrowLeft');
  await expect(tooltip).toContainText('2024-09');
  await chart.press('End');
  await expect(tooltip).toContainText('2026-08');
  await expect(tooltip).toContainText('¥2,098');
  await chart.press('ArrowRight');
  await expect(tooltip).toContainText('2026-08');
  await expect(chart).toBeFocused();
  await chart.press('Escape');
  await expect(tooltip).toBeHidden();
  await expect(chart).toBeFocused();
});

test('Escape from the keyboard inspector returns focus to the chart without reopening the dismissed month', async ({
  page,
}) => {
  await load(page);
  const chart = page.locator('.price-chart');
  await chart.focus();
  await chart.press('Home');
  const inspector = page.getByTestId('chart-tooltip');
  await expect(inspector).toContainText('2024-09');
  await chart.press('Shift+Tab');
  await expect(inspector).toBeFocused();
  await inspector.press('Escape');
  await expect(chart).toBeFocused();
  await expect(inspector).toBeHidden();
  await chart.press('End');
  await expect(inspector).toContainText('2026-08');
});

test('seasonal inspection distinguishes an estimate and its actual anchor from an unavailable observation', async ({
  page,
}) => {
  await load(page);
  await addOnly(page, 'mikan', /^Add: Satsuma/);
  const chart = page.locator('.price-chart');
  await chart.focus();
  await chart.press('End');
  const tooltip = page.getByTestId('chart-tooltip');
  await expect(tooltip).toContainText('2026-08');
  await expect(tooltip).toContainText('¥1,055');
  await expect(tooltip).toContainText('Estimated');
  await expect(tooltip).toContainText('2026-03');
  await expect(tooltip).toContainText(/5.*months old/);
  await expect(tooltip).toContainText('scheduled off-season');

  await page.getByLabel('Observed prices only', { exact: true }).check();
  await chart.focus();
  await chart.press('End');
  await expect(tooltip).toContainText('2026-08');
  await expect(tooltip).toContainText('Unavailable');
  await expect(tooltip).toContainText('scheduled off-season');
  await expect(tooltip).not.toContainText('¥1,055');
  await expectCrosshair(page);
  await expect(page.getByTestId('chart-active-point')).toHaveCount(0);
});

test('inspection retains absolute prices but explains why a specification break blocks comparison', async ({
  page,
}) => {
  await load(page);
  await addOnly(page, 'dish soap', /^Add: Dishwashing liquid · specified refill$/);
  const chart = page.locator('.price-chart');
  await chart.focus();
  await chart.press('End');
  const tooltip = page.getByTestId('chart-tooltip');
  await expect(tooltip).toContainText('2026-08');
  await expect(tooltip).toContainText('¥366');
  await expect(tooltip).toContainText('Observed');
  await expect(tooltip).toContainText(/specification/i);
  await expect(page.getByTestId('basket-change')).toHaveText('—');
  await page.getByRole('tab', { name: 'Price index', exact: true }).click();
  await page.locator('.price-chart').focus();
  await page.locator('.price-chart').press('End');
  await expect(tooltip).toContainText('2026-08');
  await expect(tooltip).toContainText(/specification/i);
  await expect(page.getByTestId('chart-active-point')).toHaveCount(0);
});

test('an entirely unsurveyed interval remains inspectable without inventing points or zero prices', async ({
  page,
}) => {
  await load(page);
  await page.locator('#city').selectOption('14205');
  await selectMonth(page, 'end', '2024-12');
  await expect(page.getByTestId('latest-cost')).toHaveText('—');
  const chart = page.locator('.price-chart');
  await expect(chart).toBeVisible();
  await chart.focus();
  await chart.press('Home');
  const tooltip = page.getByTestId('chart-tooltip');
  await expect(tooltip).toContainText('2024-09');
  await expect(tooltip).toContainText('Unavailable');
  await expect(tooltip).toContainText('city not surveyed');
  await expect(tooltip).not.toContainText('¥0');
  await expect(chart.locator('circle[data-month]')).toHaveCount(0);
  await expect(page.getByTestId('chart-active-point')).toHaveCount(0);
  await chart.press('End');
  await expect(tooltip).toContainText('2024-12');
});

test('an unavailable baseline blocks the index while retaining the inspected month’s observed status', async ({
  page,
}) => {
  await load(page);
  await page.locator('#city').selectOption('14205');
  await page.getByRole('tab', { name: 'Price index', exact: true }).click();
  const chart = page.locator('.price-chart');
  await expect(chart).toBeVisible();
  await chart.focus();
  await chart.press('End');
  const inspector = page.getByTestId('chart-tooltip');
  await expect(inspector).toContainText('2026-08');
  await expect(inspector.locator('.chart-status')).toHaveText('Observed');
  await expect(inspector.locator('.chart-readout-value')).toHaveText('—');
  await expect(inspector).toContainText('The baseline has no usable price.');
  await expect(inspector).toContainText('Percentage changes and index are unavailable.');
  await expectCrosshair(page);
  await expect(page.getByTestId('chart-active-point')).toHaveCount(0);
});

test('a pointer gesture ending outside the plot leaves later keyboard inspection usable', async ({
  page,
}) => {
  await load(page);
  const point = await plotPoint(page, 5, 0.7);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(5, 5);
  await page.mouse.up();
  await page.locator('#search').focus();
  const chart = page.locator('.price-chart');
  await chart.focus();
  await expect(page.getByTestId('chart-tooltip')).toContainText('2026-08');
  await expect(chart).toBeFocused();
});

test('quantity edits immediately recalculate an inspected point without changing its selected month', async ({
  page,
}) => {
  await load(page);
  const point = await plotPoint(page, 23, 0.7);
  await page.mouse.click(point.x - 1, point.y);
  await expect(page.getByTestId('chart-tooltip')).toContainText('¥2,098');
  await page.locator('#qty-white-bread').fill('0.5');
  await expect(page.getByTestId('latest-cost')).toHaveText('¥1,815');
  await expect(page.getByTestId('chart-tooltip')).toContainText('2026-08');
  await expect(page.getByTestId('chart-tooltip')).toContainText('¥1,815');
  await page.getByRole('tab', { name: 'Monthly data', exact: true }).click();
  await expect(page.locator('.monthly-table tbody tr').last()).toContainText('¥1,815');
});

test('compatible quantity edits settle their short transition and reduced motion updates without a tween', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await load(page);
  const chart = page.locator('.interactive-chart');
  await expect(chart).toHaveAttribute('data-transitioning', 'false');
  await page.locator('#qty-white-bread').fill('0.5');
  await expect(chart).toHaveAttribute('data-transitioning', 'true');
  await expect(page.getByTestId('latest-cost')).toHaveText('¥1,815');
  await expect(chart).toHaveAttribute('data-transitioning', 'false');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#qty-white-bread').fill('1');
  await expect(page.getByTestId('latest-cost')).toHaveText('¥2,098');
  await expect(chart).toHaveAttribute('data-transitioning', 'false');
  const point = await plotPoint(page, 23);
  await page.mouse.move(point.x - 1, point.y);
  await expect(page.getByTestId('chart-tooltip')).toContainText('¥2,098');
  expect(
    await chart.evaluate(
      (element) =>
        element
          .getAnimations({ subtree: true })
          .filter((animation) => animation.playState === 'running').length,
    ),
  ).toBe(0);
});

test('rapid quantity edits cancel earlier transitions and leave the final geometry at the actual basket cost', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await load(page);
  const chart = page.locator('.interactive-chart');
  await page.locator('#qty-white-bread').fill('0.5');
  await expect(chart).toHaveAttribute('data-transitioning', 'true');
  await page.evaluate(async () => {
    const input = document.querySelector<HTMLInputElement>('#qty-white-bread')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    const change = (value: string) => {
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    change('1.25');
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    change('1');
  });
  await expect(page.getByTestId('latest-cost')).toHaveText('¥2,098');
  await expect(chart).toHaveAttribute('data-transitioning', 'false');
  const renderedCost = await page.locator('.price-chart').evaluate((element) => {
    const ticks = [...element.querySelectorAll('text')]
      .filter((label) => /^[¥￥]/.test(label.textContent ?? ''))
      .map((label) => ({
        value: Number((label.textContent ?? '').replace(/[¥￥,]/g, '')),
        y: Number(label.getAttribute('y')) - 5,
      }))
      .sort((a, b) => a.value - b.value);
    if (ticks.length < 2) throw new Error('Numeric currency axis ticks are required.');
    const low = ticks[0],
      high = ticks.at(-1)!;
    const lastY = Number(element.querySelector('circle[data-month="2026-08"]')!.getAttribute('cy'));
    // Infer the plotted value from the visible axis and point positions, without
    // importing the chart's own geometry or calculation implementation.
    return low.value + ((low.y - lastY) / (low.y - high.y)) * (high.value - low.value);
  });
  expect(renderedCost).toBeCloseTo(2098, 3);
  await page.locator('.price-chart').focus();
  await page.locator('.price-chart').press('End');
  await expect(page.getByTestId('chart-tooltip')).toContainText('¥2,098');
  await page.getByRole('tab', { name: 'Monthly data', exact: true }).click();
  await expect(page.locator('.monthly-table tbody tr').last()).toContainText('¥2,098');
});

test('focusing hovered month details keeps that inspection available after the pointer leaves', async ({
  page,
}) => {
  await load(page);
  await hoverMonth(page, 5);
  const inspector = page.getByTestId('chart-tooltip');
  await expect(inspector).toContainText('2025-02');
  await inspector.focus();
  await page.getByRole('heading', { level: 1 }).hover();
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText('2025-02');
  await inspector.press('Escape');
  await expect(page.locator('.price-chart')).toBeFocused();
  await expect(inspector).toBeHidden();
});

test('open chart details translate, fit narrow layouts and retain an accessible equivalent table', async ({
  page,
}) => {
  await load(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const chart = page.locator('.price-chart');
  await chart.focus();
  await chart.press('End');
  await tooltipFits(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: '日本語', exact: true }).click();
  await chart.focus();
  await chart.press('End');
  const tooltip = page.getByTestId('chart-tooltip');
  await expect(tooltip).toContainText('2026-08');
  await expect(tooltip).toContainText('実測');
  await expect(tooltip).not.toContainText('Observed');
  await tooltipFits(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await chart.press('Escape');
  await page.getByRole('tab', { name: '月次データ', exact: true }).click();
  await expect(page.locator('.monthly-table tbody tr').last()).toContainText('￥2,098');
});

test('touch selects a durable month, updates on another tap and permits dismissal', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Touch selection is checked with the configured mobile context.');
  await load(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const first = await plotPoint(page, 0, 0.7);
  await page.touchscreen.tap(first.x + 1, first.y);
  const tooltip = page.getByTestId('chart-tooltip');
  await expect(tooltip).toContainText('2024-09');
  await expect(tooltip).toContainText('¥1,991');
  await tooltipFits(page);
  const last = await plotPoint(page, 23, 0.7);
  await page.touchscreen.tap(last.x - 1, last.y);
  await expect(tooltip).toContainText('2026-08');
  await expect(tooltip).toContainText('¥2,098');
  await page.touchscreen.tap(last.x - 1, last.y);
  await expect(tooltip).toBeHidden();
  await page.touchscreen.tap(last.x - 1, last.y);
  await expect(tooltip).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tooltip).toBeHidden();
});
