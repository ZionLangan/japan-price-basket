import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { CityData, Release } from '../../packages/domain/src/contracts';
import { expectRange, selectMonth } from './helpers/dates';

const storageKey = 'japan-basket-prices:v1';

function shift(month: string, delta: number) {
  const [year, number] = month.split('-').map(Number);
  const ordinal = year * 12 + number - 1 + delta;
  return `${Math.floor(ordinal / 12)}-${String((ordinal % 12) + 1).padStart(2, '0')}`;
}

async function published(page: Page) {
  const pointer = await (await page.request.get('/data/current.json')).json();
  const release: Release = await (await page.request.get(`/data/${pointer.manifest}`)).json();
  return release;
}

async function load(page: Page) {
  const release = await published(page);
  await page.goto('/');
  await expect(page.locator('.price-chart')).toBeVisible();
  await expectRange(page, release.start, release.end);
  return release;
}

async function stored(page: Page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey);
}

test('Now uses the latest published month, while a manually selected end stays fixed after reload', async ({
  page,
}) => {
  // The calendar clock is deliberately ahead of the published observations.
  await page.clock.setFixedTime(new Date('2030-12-15T12:00:00Z'));
  const release = await load(page);
  const now = page.locator('#end-latest');
  await expect(now).toHaveAttribute('aria-pressed', 'true');
  await expect(now).toContainText('Now');
  await expect(now).toContainText(release.end.slice(0, 4));
  const historical = shift(release.end, -1);
  await selectMonth(page, 'end', historical);
  await expect(now).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await stored(page)).endMode).toBe('fixed');
  await page.reload();
  await expectRange(page, release.start, historical);
  await expect(now).toHaveAttribute('aria-pressed', 'false');
  await now.click();
  await expectRange(page, release.start, release.end);
  await expect.poll(async () => (await stored(page)).endMode).toBe('latest');
  await page.reload();
  await expectRange(page, release.start, release.end);
  await expect(now).toHaveAttribute('aria-pressed', 'true');
});

test('legacy saved baskets keep an explicit historical end rather than silently adopting Now', async ({
  page,
}) => {
  const release = await load(page);
  const historical = shift(release.end, -1);
  await selectMonth(page, 'end', historical);
  await expect.poll(async () => (await stored(page)).endMode).toBe('fixed');
  await page.evaluate((key) => {
    const legacy = JSON.parse(localStorage.getItem(key)!);
    delete legacy.endMode;
    localStorage.setItem(key, JSON.stringify(legacy));
  }, storageKey);
  await page.reload();
  await expectRange(page, release.start, historical);
  await expect(page.locator('#end-latest')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await stored(page)).endMode).toBe('fixed');
});

test('year and month controls respect publication bounds without moving the other endpoint', async ({
  page,
}) => {
  const release = await load(page);
  const firstYear = release.start.slice(0, 4);
  const lastYear = release.end.slice(0, 4);
  const yearCount = Number(lastYear) - Number(firstYear) + 1;
  await expect(page.locator('#start-year option')).toHaveCount(yearCount);
  await expect(page.locator('#end-year option')).toHaveCount(yearCount);
  const firstMonths = await page
    .locator('#start-month option')
    .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  expect(firstMonths[0]).toBe(release.start.slice(5));
  expect(firstMonths.at(-1)).toBe('12');
  const lastMonths = await page
    .locator('#end-month option')
    .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  expect(lastMonths[0]).toBe('01');
  expect(lastMonths.at(-1)).toBe(release.end.slice(5));

  // A year change clamps December to the final published month, not to today.
  await selectMonth(page, 'start', `${firstYear}-12`);
  await page.locator('#start-year').selectOption(lastYear);
  await expectRange(page, release.end, release.end);
  const earlierEnd = shift(release.end, -1);
  await selectMonth(page, 'end', earlierEnd);
  await expectRange(page, release.end, earlierEnd);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByTestId('latest-cost')).toHaveText('—');
  await expect(page.locator('.price-chart')).toHaveCount(0);
  await page.locator('.range-presets button').filter({ hasText: /^All$/ }).click();
  await expectRange(page, release.start, release.end);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.price-chart')).toBeVisible();
});

test('one-year preset is inclusive and anchored to the selected end; All restores the publication window', async ({
  page,
}) => {
  const release = await load(page);
  const selectedEnd = shift(release.end, -1);
  const expectedStart = shift(selectedEnd, -11);
  await selectMonth(page, 'end', selectedEnd);
  await page.locator('.range-presets button').filter({ hasText: /^1Y$/ }).click();
  await expectRange(
    page,
    expectedStart < release.start ? release.start : expectedStart,
    selectedEnd,
  );
  await expect(page.locator('#end-latest')).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('tab', { name: 'Monthly data', exact: true }).click();
  await expect(page.locator('.monthly-table tbody tr')).toHaveCount(12);
  await expect(page.locator('.monthly-table tbody tr').last()).toContainText(selectedEnd);
  await page.locator('.range-presets button').filter({ hasText: /^All$/ }).click();
  await expectRange(page, release.start, release.end);
  await expect(page.locator('#end-latest')).toHaveAttribute('aria-pressed', 'true');
  const span =
    (Number(release.end.slice(0, 4)) - Number(release.start.slice(0, 4))) * 12 +
    Number(release.end.slice(5)) -
    Number(release.start.slice(5)) +
    1;
  await expect(page.locator('.range-presets button').filter({ hasText: /^5Y$/ })).toHaveCount(
    span >= 60 ? 1 : 0,
  );
  if (span >= 60) {
    await page.locator('.range-presets button').filter({ hasText: /^5Y$/ }).click();
    await expectRange(page, shift(release.end, -59), release.end);
    await expect(page.locator('.monthly-table tbody tr')).toHaveCount(60);
    await expect(page.locator('#end-latest')).toHaveAttribute('aria-pressed', 'true');
  }
});

for (const mode of ['latest', 'fixed'] as const) {
  test(`${mode} end preference survives a publication advancing to a newer month`, async ({
    page,
  }) => {
    const release = await published(page);
    const earlier = shift(release.end, -1);
    const city = release.cities.find((entry) => entry.id === '13100')!;
    const evidence: CityData = await (
      await page.request.get(`/data/${release.releaseId}/${city.file}`)
    ).json();
    // This intercepted test release uses real earlier observations. It is a
    // synthetic publication fixture, never a modified public evidence file.
    const olderId = `rps-${earlier}-000000000001`;
    const olderCity = {
      ...evidence,
      releaseId: olderId,
      series: Object.fromEntries(
        Object.entries(evidence.series).map(([id, rows]) => [
          id,
          rows.filter((row) => row.month <= earlier),
        ]),
      ),
    };
    const bytes = JSON.stringify(olderCity);
    const olderRelease = {
      ...release,
      releaseId: olderId,
      end: earlier,
      cities: release.cities.map((entry) => ({
        ...entry,
        end: earlier,
        sha256:
          entry.id === city.id ? createHash('sha256').update(bytes).digest('hex') : entry.sha256,
      })),
    };
    let advance = false;
    await page.route('**/data/current.json', (route) =>
      advance
        ? route.continue()
        : route.fulfill({
            json: { releaseId: olderId, manifest: `${olderId}/manifest.json` },
          }),
    );
    await page.route(`**/data/${olderId}/manifest.json`, (route) =>
      route.fulfill({ json: olderRelease }),
    );
    await page.route(`**/data/${olderId}/${city.file}`, (route) =>
      route.fulfill({ body: bytes, contentType: 'application/json' }),
    );
    await page.goto('/');
    await expect(page.locator('.price-chart')).toBeVisible();
    await expectRange(page, release.start, earlier);
    if (mode === 'fixed') {
      await selectMonth(page, 'end', shift(earlier, -1));
      await selectMonth(page, 'end', earlier);
    }
    await expect.poll(async () => (await stored(page)).endMode).toBe(mode);
    advance = true;
    await page.reload();
    await expect(page.locator('.price-chart')).toBeVisible();
    const expected = mode === 'latest' ? release.end : earlier;
    await expectRange(page, release.start, expected);
    await expect(page.locator('#end-latest')).toHaveAttribute(
      'aria-pressed',
      mode === 'latest' ? 'true' : 'false',
    );
    await page.getByRole('tab', { name: 'Monthly data', exact: true }).click();
    await expect(page.locator('.monthly-table tbody tr').last()).toContainText(expected);
  });
}

test('month controls reflow and stay accessible in both languages, with fixed chart details and concise copy', async ({
  page,
}) => {
  await load(page);
  await expect(page.getByText('Automatically saved here', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Monthly survey prices · JPY', { exact: false })).toHaveCount(0);
  for (const language of ['English', '日本語']) {
    await page.getByRole('button', { name: language, exact: true }).click();
    for (const id of ['start-year', 'start-month', 'end-year', 'end-month']) {
      const field = page.locator(`#${id}`);
      await field.focus();
      await expect(field).toBeFocused();
      await expect(field).toHaveAccessibleName(/\S/);
    }
    await expect(page.locator('#end-month option[value="01"]')).toHaveText(
      language === 'English' ? 'Jan' : '1月',
    );
    for (const width of [320, 390, 768, 1366]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const chart = page.locator('.price-chart');
    await chart.focus();
    await chart.press('End');
    await expect(page.getByTestId('chart-tooltip')).toBeVisible();
    await expect(chart.locator('title')).toHaveCount(0);
    await expect(chart.locator('[title]')).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
});
