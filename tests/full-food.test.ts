import { expect, it } from 'vitest';
import { city, release } from './fixture';
import { evaluate, productEligibility } from '../packages/domain/src/domain';
import type { Product } from '../packages/domain/src/contracts';

const tokyo = city();
const cost = (productId: string, month: string, quantity: string, unit: Product['unit']) =>
  evaluate(
    {
      schemaVersion: 1,
      name: 'Official quantity reconciliation',
      cityId: '13100',
      start: month,
      end: month,
      items: [{ productId, quantity, unit }],
    },
    release,
    tokyo,
    true,
  )[0];

it('keeps a fixed 120 g dashi basket across the Japanese multipack caption change', () => {
  expect(cost('bonito-dashi', '2009-12', '120', 'g').cost).toBe('313');
  expect(cost('bonito-dashi', '2010-01', '120', 'g').cost).toBe('321');
  expect(cost('bonito-dashi', '2010-01', '120', 'g').status).toBe('observed');
});

it('compares drained corn weight across cans and the kilogram reporting basis', () => {
  expect(cost('canned-vegetables', '2000-01', '275', 'g').cost).toBe('195');
  expect(cost('canned-vegetables', '2014-08', '130', 'g').cost).toBe('142');
  expect(cost('canned-vegetables', '2014-09', '130', 'g').cost).toBe('136.37');
  const corn = release.products.find((p) => p.id === 'canned-vegetables')!;
  expect(corn.comparisonNote?.en).toContain('drained');
});

it('discloses conflicting captions without introducing fivefold or package-size price jumps', () => {
  for (const [id, month, quantity, unit, expected] of [
    ['glutinous-rice', '2002-01', '1', 'kg', '587'],
    ['processed-cheese', '2000-01', '225', 'g', '360'],
    ['imported-wine', '2006-12', '750', 'mL', '1149'],
  ] as const) {
    const result = cost(id, month, quantity, unit);
    expect(result.cost).toBe(expected);
    expect(result.status).toBe('estimated');
    expect(result.items[0].reason).toBe('quantity-conversion');
    const product = release.products.find((p) => p.id === id)!;
    const segment = product.segments.find((s) => s.id === result.items[0].segmentId)!;
    expect(segment.quantityConversion?.basis).toBe(
      'dated-specification-over-conflicting-price-caption',
    );
    expect(segment.quantityConversion?.description.en).toBeTruthy();
    expect(segment.quantityConversion?.description.ja).toBeTruthy();
  }
  expect(cost('glutinous-rice', '2002-02', '1', 'kg').status).toBe('observed');
  expect(cost('processed-cheese', '2000-02', '225', 'g').status).toBe('observed');
  expect(cost('imported-wine', '2007-01', '750', 'mL').status).toBe('observed');
});

it('keeps recovered early Tokyo-only prices out of other cities', () => {
  const sapporo = city('01100');
  for (const id of ['canned-vegetables', 'ketchup', 'dry-soup', 'cola']) {
    expect(tokyo.series[id].find((r) => r.month === '2000-01')?.status).toBe('observed');
    const other = sapporo.series[id].find((r) => r.month === '2000-01')!;
    expect(other.status).toBe('not-surveyed');
    expect(other.price).toBeNull();
    expect(other.sourceColumn).toBeUndefined();
  }
});

it('retains real food-form replacements and unresolved regional early definitions as bounded histories', () => {
  const wet = release.products.find((p) => p.id === 'fresh-salted-wakame')!;
  const dry = release.products.find((p) => p.id === 'dried-cut-wakame')!;
  expect(wet.segments.at(-1)?.end).toBe('2026-02');
  expect(dry.segments[0].start).toBe('2026-03');
  expect(productEligibility(wet, tokyo.series[wet.id], '2026-01', '2026-08').eligible).toBe(false);
  expect(productEligibility(dry, tokyo.series[dry.id], '2026-01', '2026-08').eligible).toBe(false);
  const noodles = release.products.find((p) => p.id === 'okinawa-soba')!;
  expect(noodles.segments[0].start).toBe('2007-07');
  expect(noodles.segments.at(-1)?.end).toBe('2021-12');
  expect(city('47201').series[noodles.id].some((r) => r.month < '2007-07')).toBe(false);
});
