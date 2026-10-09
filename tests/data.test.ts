import { expect, it } from 'vitest';
import { fixture, release, city } from './fixture';
import { ObservationSchema } from '../packages/domain/src/contracts';
import { months, quantityCost } from '../packages/domain/src/domain';

it('validates all 320 source months, distinct historical identities and exact observation locators', () => {
  expect(release.start).toBe('2000-01');
  expect(release.end).toBe('2026-08');
  expect(release.cities.filter((c) => !c.historical)).toHaveLength(81);
  expect(release.cities.some((c) => c.historical)).toBe(true);
  expect(release.policyVersion).toBe('1.2');
  expect(release.products).toHaveLength(311);
  expect(release.products.filter((p) => p.selectable !== false)).toHaveLength(306);
  expect(
    release.products
      .filter((p) => p.selectable === false)
      .every((p) => ['4431', '4441'].includes(p.code)),
  ).toBe(true);
  expect(new Set(release.cities.map((c) => c.id)).size).toBe(release.cities.length);
  expect(new Set(release.products.map((p) => p.id)).size).toBe(release.products.length);
  expect(new Set(release.products.map((p) => p.code)).size).toBe(277);
  const foods = release.products.filter((p) => p.category === 'food');
  expect(new Set(foods.map((p) => p.code)).size).toBe(274);
  expect(
    new Set(foods.filter((p) => p.segments.some((s) => s.end === release.end)).map((p) => p.code))
      .size,
  ).toBe(218);
  const sourceIds = new Set(release.sources.map((s) => s.id));
  expect(sourceIds.size).toBe(release.sources.length);
  const calendar = months(release.start, release.end);
  expect(calendar).toHaveLength(320);
  for (const month of calendar) {
    for (const category of ['food', 'household', 'specifications']) {
      expect(sourceIds.has(`${month}-${category}`), `${month} ${category}`).toBe(true);
    }
  }
  const failures: string[] = [];
  for (const c of release.cities) {
    const data = city(c.id);
    const actualCells = new Set<string>();
    for (const product of release.products) {
      const expectedMonths = product.segments
        .flatMap((s) => months(s.start, s.end))
        .filter((month) => month >= c.start && month <= c.end);
      expect(new Set(expectedMonths).size, product.id).toBe(expectedMonths.length);
      for (const segment of product.segments) {
        expect(segment.quoteQuantity, segment.id).toBeDefined();
        expect(segment.quoteUnit, segment.id).toBeDefined();
        expect(() => quantityCost('1', '1', product.unit, product, segment)).not.toThrow();
        if (segment.continuityFromPrevious) {
          expect(segment.continuityReason, segment.id).toBeTruthy();
          expect(segment.continuityEvidence?.length, segment.id).toBeGreaterThan(0);
        }
      }
      const rows = data.series[product.id];
      expect(rows.map((row) => row.month)).toEqual(expectedMonths);
      for (const row of rows) {
        const locator = `${c.id} ${product.id} ${row.month}`;
        const segment = product.segments.find((s) => s.id === row.segmentId);
        if (
          !sourceIds.has(row.sourceId) ||
          !segment ||
          segment.start > row.month ||
          segment.end < row.month
        )
          failures.push(`${locator}: missing source/segment`);
        if ((row.month < c.start || row.month > c.end) && row.status !== 'not-surveyed')
          failures.push(`${locator}: price assigned outside city scope`);
        if (row.status === 'seasonal' && segment?.surveyMonths.includes(Number(row.month.slice(5))))
          failures.push(`${locator}: scheduled month marked off-season`);
        if (row.status === 'observed') {
          if (!row.sourceColumn || Number(row.price) !== Number(row.raw))
            failures.push(`${locator}: changed raw price or missing cell`);
          const key = `${product.code} ${row.month}`;
          if (actualCells.has(key))
            failures.push(`${locator}: one source cell assigned to multiple variants`);
          actualCells.add(key);
        }
      }
    }
  }
  expect(failures.slice(0, 50)).toEqual([]);
}, 90000);
it('keeps missing source tokens and never treats a blank price as zero', () => {
  const rows = fixture.series['01202']['broccoli'];
  const row = rows.find((observation: { month: string }) => observation.month === '2024-09')!;
  expect(row.price).toBeNull();
  expect(row.raw).toBe('...');
  expect(ObservationSchema.safeParse({ ...row, status: 'observed' }).success).toBe(false);
  expect(ObservationSchema.safeParse({ ...row, price: '0' }).success).toBe(false);
});
it('reconciles August 2026 values from different source columns and preserves locators', () => {
  for (const [cityId, bread, potato, sugar] of [
    ['01100', '647', '555', '293'],
    ['27100', '617', '604', '279'],
    ['47201', '885', '540', '392'],
  ]) {
    const series = city(cityId).series;
    expect(series['white-bread'].at(-1)?.price).toBe(bread);
    expect(series['potatoes'].at(-1)?.price).toBe(potato);
    expect(series['white-sugar'].at(-1)?.price).toBe(sugar);
    expect(series['white-bread'].at(-1)?.sourceRow).toBe(14);
  }
});
