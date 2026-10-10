import { describe, expect, it } from 'vitest';
import { evaluate } from '../packages/domain/src/domain';
import type {
  Basket,
  CityData,
  Observation,
  Product,
  Release,
} from '../packages/domain/src/contracts';

// Small synthetic fixtures isolate result semantics; none is published as observed data.
const product = (id: string): Product => ({
  id,
  code: id,
  familyId: id,
  variantId: id,
  names: { en: `Synthetic ${id}`, ja: `合成テスト ${id}` },
  aliases: [],
  category: 'food',
  unit: 'kg',
  quoteQuantity: '1',
  quoteLabel: { en: 'Synthetic 1 kg', ja: '合成テスト1kg' },
  units: ['kg', 'g'],
  presets: ['1'],
  segments: [
    {
      id: `${id}-original`,
      start: '2025-01',
      end: '2026-12',
      definition: 'Synthetic calculation fixture',
      detail: '',
      sourceUrl: 'https://example.com/synthetic-fixture',
      surveyMonths: Array.from({ length: 12 }, (_, i) => i + 1),
      continuityFromPrevious: false,
    },
  ],
});
const a = product('a');
const b = product('b');
const release: Release = {
  schemaVersion: 1,
  releaseId: 'synthetic-result-details',
  policyVersion: '1.2',
  start: '2025-01',
  end: '2026-12',
  builtAt: '2026-10-10T00:00:00Z',
  sourceName: { en: 'Synthetic result fixture', ja: '合成テスト' },
  cities: [
    {
      id: '13100',
      names: { en: 'Synthetic scope', ja: '合成テスト地域' },
      start: '2025-01',
      end: '2026-12',
      file: 'cities/13100.json',
      sha256: '0'.repeat(64),
    },
  ],
  products: [a, b],
  sources: [],
};
const observation = (
  p: Product,
  month: string,
  price: string | null,
  status: Observation['status'] = 'observed',
): Observation => ({
  month,
  price,
  status,
  segmentId: p.segments[0].id,
  sourceId: 'synthetic-source',
  raw: price ?? '-',
  sourceRow: 1,
  sourceSheet: 'synthetic',
  sourceUnit: '1 kg',
  sourceRevision: null,
});
const data = (series: CityData['series']): CityData => ({
  schemaVersion: 1,
  releaseId: release.releaseId,
  cityId: '13100',
  scopeId: '13100',
  series,
});
const basket: Basket = {
  schemaVersion: 1,
  name: 'Synthetic result fixture',
  cityId: '13100',
  start: '2025-01',
  end: '2025-02',
  items: [
    { productId: 'a', quantity: '2', unit: 'kg' },
    { productId: 'b', quantity: '1', unit: 'kg' },
  ],
};

describe('complete result details', () => {
  it('reports exact total yen changes and item-price counts alongside percentage and index', () => {
    const rows = evaluate(
      basket,
      release,
      data({
        a: [observation(a, '2025-01', '100'), observation(a, '2025-02', '110')],
        b: [observation(b, '2025-01', '200'), observation(b, '2025-02', '220')],
      }),
    );
    expect(rows[0]).toMatchObject({
      cost: '400',
      changeYen: '0',
      change: '0',
      index: '100',
      observedCount: 2,
      estimatedCount: 0,
      unavailableCount: 0,
    });
    expect(rows[1]).toMatchObject({
      cost: '440',
      changeYen: '40',
      change: '10',
      index: '110',
      observedCount: 2,
      estimatedCount: 0,
      unavailableCount: 0,
    });
    expect(Object.values(rows[1].contributions)).toEqual(['20', '20']);
    const negative = evaluate(
      basket,
      release,
      data({
        a: [observation(a, '2025-01', '110'), observation(a, '2025-02', '100')],
        b: [observation(b, '2025-01', '220'), observation(b, '2025-02', '200')],
      }),
    );
    expect(negative[1].changeYen).toBe('-40');
  });

  it('does not round fractional costs before subtracting the baseline', () => {
    const rows = evaluate(
      { ...basket, items: [{ productId: 'a', quantity: '0.3', unit: 'kg' }] },
      release,
      data({
        a: [observation(a, '2025-01', '0.1'), observation(a, '2025-02', '0.2')],
      }),
    );
    expect(rows[1]).toMatchObject({ cost: '0.06', changeYen: '0.03', change: '100' });
  });

  it('counts actual anchors separately from estimated target prices and never loses unavailable goods', () => {
    const city = data({
      a: [observation(a, '2025-01', '100'), observation(a, '2025-02', '110')],
      b: [observation(b, '2025-01', '200'), observation(b, '2025-02', null, 'temporary')],
    });
    expect(evaluate(basket, release, city)[1]).toMatchObject({
      cost: '420',
      changeYen: '20',
      observedCount: 1,
      estimatedCount: 1,
      unavailableCount: 0,
      status: 'estimated',
    });
    expect(evaluate(basket, release, city, true)[1]).toMatchObject({
      cost: null,
      changeYen: null,
      observedCount: 1,
      estimatedCount: 0,
      unavailableCount: 1,
      status: 'unavailable',
    });
    const missingBaseline = data({
      ...city.series,
      b: [observation(b, '2025-01', null, 'not-surveyed'), observation(b, '2025-02', '220')],
    });
    expect(evaluate(basket, release, missingBaseline)[1]).toMatchObject({
      cost: '440',
      changeYen: null,
      change: null,
      index: null,
    });
  });

  it('leaves total yen changes unavailable across unresolved definition changes', () => {
    const changed: Product = {
      ...a,
      segments: [
        { ...a.segments[0], end: '2025-01' },
        { ...a.segments[0], id: 'a-replacement', start: '2025-02', continuityFromPrevious: false },
      ],
    };
    const rows = evaluate(
      { ...basket, items: [basket.items[0]] },
      { ...release, products: [changed] },
      data({
        a: [
          observation(changed, '2025-01', '100'),
          { ...observation(changed, '2025-02', '110'), segmentId: 'a-replacement' },
        ],
      }),
    );
    expect(rows[1]).toMatchObject({
      cost: '220',
      comparable: false,
      changeYen: null,
      change: null,
      index: null,
      observedCount: 1,
    });
  });

  it('counts quantity conversions as estimates even when their source price is observed', () => {
    const countProduct: Product = {
      ...a,
      unit: 'count',
      units: ['count'],
      segments: [
        {
          ...a.segments[0],
          quoteQuantity: '1',
          quoteUnit: 'kg',
          quantityConversion: {
            from: 'count',
            to: 'kg',
            factor: '0.06',
            estimated: true,
            evidenceUrl: 'https://example.com/synthetic-fixture',
            description: { en: 'Synthetic count assumption', ja: '合成テスト換算' },
          },
        },
      ],
    };
    const rows = evaluate(
      { ...basket, items: [{ productId: 'a', quantity: '10', unit: 'count' }] },
      { ...release, products: [countProduct] },
      data({
        a: [
          observation(countProduct, '2025-01', '100'),
          observation(countProduct, '2025-02', '110'),
        ],
      }),
    );
    expect(rows[1]).toMatchObject({
      cost: '66',
      changeYen: '6',
      observedCount: 0,
      estimatedCount: 1,
      unavailableCount: 0,
      status: 'estimated',
    });
  });

  it('does not portray an empty basket as an observed zero-price comparison', () => {
    expect(evaluate({ ...basket, items: [] }, release, data({}))[1]).toMatchObject({
      cost: null,
      changeYen: null,
      observedCount: 0,
      estimatedCount: 0,
      unavailableCount: 0,
      status: 'unavailable',
    });
  });
});
