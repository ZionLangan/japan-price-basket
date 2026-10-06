import { expect, it } from 'vitest';
import { fixture, release, city } from './fixture';
import { ObservationSchema } from '../packages/domain/src/contracts';

it('validates every city series, unique keys, all 24 months and source locators', () => {
  expect(release.cities).toHaveLength(81);
  expect(release.products).toHaveLength(20);
  expect(new Set(release.cities.map((c) => c.id)).size).toBe(81);
  expect(new Set(release.products.map((p) => p.id)).size).toBe(20);
  const sourceIds = new Set(release.sources.map((s) => s.id));
  for (const c of release.cities)
    for (const product of release.products) {
      const rows = city(c.id).series[product.id];
      expect(rows).toHaveLength(24);
      expect(new Set(rows.map((o) => o.month)).size).toBe(24);
      for (const row of rows) {
        expect(sourceIds.has(row.sourceId)).toBe(true);
        expect(
          product.segments.some(
            (s) => s.id === row.segmentId && s.start <= row.month && s.end >= row.month,
          ),
        ).toBe(true);
        if (row.month < c.start) expect(row.status).toBe('not-surveyed');
        if (row.status === 'seasonal')
          expect(product.segments.find((s) => s.id === row.segmentId)!.surveyMonths).not.toContain(
            Number(row.month.slice(5)),
          );
      }
    }
});
it('keeps missing source tokens and never treats a blank price as zero', () => {
  const rows = fixture.series['01202']['broccoli'];
  expect(rows[0].price).toBeNull();
  expect(rows[0].raw).toBe('...');
  expect(ObservationSchema.safeParse({ ...rows[0], status: 'observed' }).success).toBe(false);
  expect(ObservationSchema.safeParse({ ...rows[0], price: '0' }).success).toBe(false);
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
