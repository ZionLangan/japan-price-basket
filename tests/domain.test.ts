import { describe, expect, it } from 'vitest';
import {
  evaluate,
  quantityCost,
  convertQuantity,
  resolvePrice,
  searchProducts,
  months,
  productEligibility,
} from '../packages/domain/src/domain';
import {
  validateBasket,
  type Basket,
  type Observation,
  type Product,
} from '../packages/domain/src/contracts';
import { city, release } from './fixture';

const bread = release.products.find((p) => p.id === 'white-bread')!;
const basket: Basket = {
  schemaVersion: 1,
  name: 'Official staples test',
  cityId: '13100',
  start: '2024-09',
  end: '2026-08',
  items: ['white-bread', 'white-sugar', 'cabbage', 'potatoes', 'carrots'].map((productId) => ({
    productId,
    quantity: '1',
    unit: 'kg',
  })),
};
// Clearly synthetic prices for policy edge cases; these never appear on the site.
const syntheticProduct: Product = {
  ...bread,
  segments: [
    {
      ...bread.segments[0],
      id: 'synthetic-segment',
      start: '2024-01',
      end: '2026-12',
      surveyMonths: [6, 7],
    },
  ],
};
const synthetic = (
  month: string,
  status: Observation['status'],
  price: string | null = null,
): Observation => ({
  month,
  status,
  price,
  segmentId: 'synthetic-segment',
  sourceId: 'synthetic-source',
  raw: price ?? '...',
  sourceRow: 1,
  sourceSheet: 'synthetic',
  sourceUnit: 'synthetic 1 kg',
  sourceRevision: null,
});

describe('reviewed real monthly data', () => {
  it('reconciles the independently audited January 2000 Tokyo basket and exact ten-kg rice quote', () => {
    const results = evaluate({ ...basket, start: '2000-01' }, release, city());
    expect(results).toHaveLength(320);
    expect(results[0].items.map((item) => item.cost)).toEqual(['422', '218', '160', '280', '271']);
    expect(results[0].cost).toBe('1351');
    expect(results.at(-1)?.cost).toBe('2098');
    expect(Number(results.at(-1)?.change)).toBeCloseTo(55.2923760178);
    const rice = evaluate(
      {
        ...basket,
        start: '2000-01',
        end: '2000-01',
        items: [{ productId: 'koshihikari-rice', quantity: '1', unit: 'kg' }],
      },
      release,
      city(),
    );
    expect(rice[0].items[0].price).toBe('5922');
    expect(rice[0].cost).toBe('592.2');
  });
  it('reconciles the newly reviewed December 2020 staple endpoint without filling missing cities', () => {
    const results = evaluate({ ...basket, start: '2020-12' }, release, city());
    expect(results).toHaveLength(69);
    expect(results[0].cost).toBe('1468');
    expect(results.at(-1)?.cost).toBe('2098');
    expect(results.every((row) => row.status === 'observed')).toBe(true);
    const newCity = evaluate(
      { ...basket, cityId: '14205', start: '2020-12' },
      release,
      city('14205'),
    );
    expect(newCity.filter((row) => row.month < '2025-01').every((row) => row.cost === null)).toBe(
      true,
    );
  });
  it('keeps newly reviewed package and formulation changes separate from earlier comparisons', () => {
    for (const [productId, start, boundary] of [
      ['dishwashing-liquid', '2020-12', '2023-10'],
      ['liquid-laundry-detergent', '2020-12', '2022-07'],
      ['liquid-laundry-detergent', '2023-01', '2024-08'],
    ]) {
      const results = evaluate(
        {
          ...basket,
          start,
          items: [
            {
              productId,
              quantity: '1',
              unit: release.products.find((product) => product.id === productId)!.unit,
            },
          ],
        },
        release,
        city(),
      );
      const before = results.filter((row) => row.month < boundary).at(-1)!;
      const after = results.find((row) => row.month === boundary)!;
      expect(before.cost).not.toBeNull();
      expect(before.change).not.toBeNull();
      expect(after.cost).not.toBeNull();
      expect(after.change).toBeNull();
      expect(after.index).toBeNull();
    }
  });
  it('reconciles both endpoints of the Tokyo staple basket', () => {
    const result = evaluate(basket, release, city());
    expect(result).toHaveLength(24);
    expect(result[0].cost).toBe('1991');
    expect(result.at(-1)?.cost).toBe('2098');
    expect(Number(result.at(-1)?.change)).toBeCloseTo(5.3741838272);
    expect(result.every((r) => r.status === 'observed')).toBe(true);
  });
  it('does not inherit former-city prices for Fujisawa', () => {
    const results = evaluate({ ...basket, cityId: '14205' }, release, city('14205'));
    expect(results.slice(0, 4).every((r) => r.cost === null && r.status === 'unavailable')).toBe(
      true,
    );
    expect(results[4].status).toBe('observed');
    expect(results.at(-1)?.change).toBeNull();
  });
  it('blocks the real October 2025 refill-size boundary', () => {
    const result = evaluate(
      { ...basket, items: [{ productId: 'dishwashing-liquid', quantity: '1', unit: 'package' }] },
      release,
      city(),
    );
    expect(result.find((r) => r.month === '2025-09')?.change).not.toBeNull();
    expect(result.find((r) => r.month === '2025-10')?.cost).not.toBeNull();
    expect(result.find((r) => r.month === '2025-10')?.change).toBeNull();
    expect(result.at(-1)?.comparable).toBe(false);
  });
  it('uses real seasonal anchors and observed-only leaves gaps', () => {
    const product = release.products.find((p) => p.id === 'satsuma-mandarins')!;
    const rows = city().series[product.id];
    const value = resolvePrice(product, rows, '2026-08', false);
    expect(value.status).toBe('estimated');
    expect(value.anchor).toBe('2026-03');
    expect(value.age).toBe(5);
    expect(resolvePrice(product, rows, '2026-08', true).price).toBeNull();
  });
  it('never drops an unavailable selected good from a basket', () => {
    const withBroccoli = {
      ...basket,
      items: [...basket.items, { productId: 'broccoli', quantity: '1', unit: 'kg' as const }],
    };
    const results = evaluate({ ...withBroccoli, cityId: '01202' }, release, city('01202'));
    expect(results[0].items).toHaveLength(6);
    expect(results[0].cost).toBeNull();
  });
  it('refuses a mismatched release or geographic scope', () => {
    expect(() => evaluate(basket, release, { ...city(), releaseId: 'other' })).toThrow();
    expect(() => evaluate(basket, release, { ...city(), scopeId: 'old-city' })).toThrow();
  });
  it('calculates annual changes outside the visible range and contributions from exact item costs', () => {
    const result = evaluate({ ...basket, start: '2026-01' }, release, city());
    expect(result[0].yoy).not.toBeNull();
    const entire = evaluate(basket, release, city());
    expect(Object.values(entire.at(-1)!.contributions).reduce((sum, v) => sum + Number(v), 0)).toBe(
      107,
    );
  });
});

describe('decimal quantities and search', () => {
  it('uses dated source quantities for monthly totals, index and annual changes', () => {
    // Synthetic prices isolate quote normalization; they are never public data.
    const first = {
      ...syntheticProduct.segments[0],
      start: '2025-01',
      end: '2025-12',
      quoteQuantity: '10',
      quoteUnit: 'kg' as const,
    };
    const second = {
      ...first,
      id: 'synthetic-five-kg',
      start: '2026-01',
      end: '2026-12',
      quoteQuantity: '5',
      continuityFromPrevious: true,
    };
    const product = { ...syntheticProduct, segments: [first, second] };
    const localRelease = { ...release, products: [product] };
    const localCity = {
      ...city(),
      series: {
        [product.id]: [
          synthetic('2025-01', 'observed', '1000'),
          { ...synthetic('2026-01', 'observed', '600'), segmentId: second.id },
        ],
      },
    };
    const results = evaluate(
      { ...basket, start: '2025-01', end: '2026-01', items: [basket.items[0]] },
      localRelease,
      localCity,
    );
    expect(results[0].cost).toBe('100');
    expect(results.at(-1)).toMatchObject({ cost: '120', index: '120', change: '20', yoy: '20' });
    expect(
      quantityCost('100', '500', 'g', product, { ...first, quoteQuantity: '100', quoteUnit: 'g' }),
    ).toBe('500');
    expect(() => quantityCost('100', '1', 'kg', product, { ...first, quoteUnit: 'count' })).toThrow(
      'invalidUnit',
    );
    const unresolved = {
      ...product,
      segments: [first, { ...second, continuityFromPrevious: false }],
    };
    const blocked = evaluate(
      { ...basket, start: '2025-01', end: '2026-01', items: [basket.items[0]] },
      { ...localRelease, products: [unresolved] },
      localCity,
    );
    expect(blocked.at(-1)).toMatchObject({ cost: '120', index: null, change: null, yoy: null });
  });
  it('distinguishes an inactive historical form from a city not surveyed', () => {
    expect(resolvePrice(syntheticProduct, [], '2000-01', false)).toMatchObject({
      status: 'unavailable',
      reason: 'variant-inactive',
      price: null,
    });
    expect(resolvePrice(syntheticProduct, [], '2025-01', false)).toMatchObject({
      status: 'unavailable',
      reason: 'not-surveyed',
      price: null,
    });
  });
  it('prices source packages by their exact declared mass, volume and count', () => {
    const rice = release.products.find((p) => p.id === 'koshihikari-rice')!;
    const milk = release.products.find((p) => p.id === 'carton-milk')!;
    const eggs = release.products.find((p) => p.id === 'mixed-size-eggs')!;
    expect(quantityCost('4326', '1', 'kg', rice)).toBe('865.2');
    expect(quantityCost('264', '500', 'mL', milk)).toBe('132');
    expect(quantityCost('321', '6', 'count', eggs)).toBe('192.6');
    expect(convertQuantity('0.5', 'L', 'mL')).toBe('500');
    expect(convertQuantity('500', 'mL', 'L')).toBe('0.5');
    expect(() => convertQuantity('1', 'count', 'kg')).toThrow();
  });
  it('converts within dimensions with no early rounding', () => {
    expect(quantityCost('566', '250', 'g', bread)).toBe('141.5');
    expect(quantityCost('566', '0.123456', 'kg', bread)).toBe('69.876096');
    expect(() => quantityCost('566', '1', 'L', bread)).toThrow();
    expect(() => quantityCost('566', '1', 'count', bread)).toThrow();
  });
  it('matches both languages, aliases, full-width item codes and categories', () => {
    expect(searchProducts(release.products, 'ばれいしょ', 'all')[0].id).toBe('potatoes');
    expect(searchProducts(release.products, '１４１２', 'all')[0].id).toBe('potatoes');
    expect(searchProducts(release.products, 'POTATO', 'food').map((p) => p.id)).toContain(
      'potatoes',
    );
    expect(searchProducts(release.products, 'potato', 'household')).toHaveLength(0);
  });
  it('validates input dates, units, quantities, duplicate and unknown products', () => {
    for (const patch of [
      { cityId: 'unknown' },
      { start: '2026-09' },
      { end: '2024-08' },
      { items: [{ productId: 'white-bread', quantity: '0', unit: 'kg' }] },
      { items: [{ productId: 'white-bread', quantity: 'NaN', unit: 'kg' }] },
      { items: [{ productId: 'white-bread', quantity: '1', unit: 'L' }] },
      { items: [{ productId: 'unknown', quantity: '1', unit: 'kg' }] },
      { items: [basket.items[0], basket.items[0]] },
      { name: '' },
    ]) {
      expect(() => validateBasket({ ...basket, ...patch }, release)).toThrow();
    }
  });
});

describe('synthetic gap-policy edge cases', () => {
  it('carries seasonal prices across approved definitions using the actual anchor quote', () => {
    const earlier = {
      ...syntheticProduct.segments[0],
      end: '2025-07',
      quoteQuantity: '100',
      quoteUnit: 'g' as const,
    };
    const later = {
      ...earlier,
      id: 'synthetic-seasonal-kg',
      start: '2025-08',
      end: '2026-12',
      quoteQuantity: '1',
      quoteUnit: 'kg' as const,
      continuityFromPrevious: true,
    };
    const product = { ...syntheticProduct, segments: [earlier, later] };
    const rows = [
      synthetic('2025-07', 'observed', '200'),
      ...months('2025-08', '2026-06').map((month) => ({
        ...synthetic(month, 'seasonal'),
        segmentId: later.id,
      })),
    ];
    const value = resolvePrice(product, rows, '2026-05', false);
    expect(value).toMatchObject({
      status: 'estimated',
      price: '200',
      anchor: '2025-07',
      segmentId: earlier.id,
      sourceUnit: rows[0].sourceUnit,
    });
    const results = evaluate(
      { ...basket, start: '2025-07', end: '2026-05', items: [basket.items[0]] },
      { ...release, products: [product] },
      { ...city(), series: { [product.id]: rows } },
    );
    expect(results.every((r) => r.cost === '2000')).toBe(true);
    expect(results.at(-1)?.index).toBe('100');
    expect(resolvePrice(product, rows, '2026-06', false).price).toBeNull();
    expect(resolvePrice(product, rows, '2026-05', true).price).toBeNull();
  });
  it('checks historical and revised seasonal calendars rather than only the target segment', () => {
    const earlier = { ...syntheticProduct.segments[0], end: '2025-08', surveyMonths: [7, 8] };
    const later = {
      ...earlier,
      id: 'synthetic-calendar-change',
      start: '2025-09',
      surveyMonths: [7],
      continuityFromPrevious: true,
    };
    const product = { ...syntheticProduct, segments: [earlier, later] };
    const rows = [
      synthetic('2025-07', 'observed', '100'),
      synthetic('2025-08', 'seasonal'),
      { ...synthetic('2025-09', 'seasonal'), segmentId: later.id },
    ];
    // August was a survey month under its own definition; September cannot skip it.
    expect(resolvePrice(product, rows, '2025-09', false).price).toBeNull();
    const offCalendarAnchor = {
      ...product,
      segments: [{ ...earlier, surveyMonths: [8] }, later],
    };
    expect(resolvePrice(offCalendarAnchor, rows, '2025-08', false).price).toBeNull();
  });
  it('generalizes reviewed market gaps and retains anchor conversions across approved changes', () => {
    const earlier = {
      ...syntheticProduct.segments[0],
      end: '2025-07',
      quoteQuantity: '1',
      quoteUnit: 'kg' as const,
      quantityConversion: {
        from: 'count' as const,
        to: 'kg' as const,
        factor: '0.06',
        estimated: true,
        evidenceUrl: 'https://example.com/synthetic-definition',
        description: { en: 'Synthetic 60 g conversion', ja: '合成テスト用60g換算' },
      },
    };
    const later = {
      ...earlier,
      id: 'synthetic-count-quote',
      start: '2025-08',
      end: '2026-12',
      quoteQuantity: '10',
      quoteUnit: 'count' as const,
      quantityConversion: undefined,
      continuityFromPrevious: true,
    };
    const product: Product = {
      ...syntheticProduct,
      unit: 'count',
      units: ['count'],
      segments: [earlier, later],
      missingPriceEstimate: { maxMonths: 2, tokens: ['-'], allowEquivalentSegments: true },
    };
    const rows = [
      synthetic('2025-07', 'observed', '300'),
      ...['2025-08', '2025-09', '2025-10'].map((month) => ({
        ...synthetic(month, 'unavailable'),
        raw: '-',
        segmentId: later.id,
      })),
    ];
    const results = evaluate(
      {
        ...basket,
        start: '2025-07',
        end: '2025-10',
        items: [{ productId: product.id, quantity: '10', unit: 'count' }],
      },
      { ...release, products: [product] },
      { ...city(), series: { [product.id]: rows } },
    );
    expect(results.map((row) => row.cost)).toEqual(['180', '180', '180', null]);
    expect(results[1].items[0]).toMatchObject({
      reason: 'assumed-gap',
      anchor: '2025-07',
      age: 1,
      segmentId: earlier.id,
    });
    expect(resolvePrice(product, rows, '2025-08', true).price).toBeNull();
    const inactive = {
      ...product,
      segments: [{ ...earlier, end: '2025-06' }, later],
    };
    expect(resolvePrice(inactive, rows, '2025-08', false).price).toBeNull();
    const inactiveGap = [
      { ...rows[0], month: '2025-06' },
      { ...synthetic('2025-07', 'unavailable'), raw: '-' },
      rows[1],
    ];
    expect(resolvePrice(inactive, inactiveGap, '2025-08', false).price).toBeNull();
  });
  it('permits two temporary months and never chains a third', () => {
    const rows = [
      synthetic('2025-01', 'observed', '100'),
      ...['02', '03', '04'].map((m) => synthetic(`2025-${m}`, 'temporary')),
    ];
    expect(resolvePrice(syntheticProduct, rows, '2025-03', false)).toMatchObject({
      status: 'estimated',
      anchor: '2025-01',
      age: 2,
    });
    expect(resolvePrice(syntheticProduct, rows, '2025-04', false).price).toBeNull();
  });
  it('stops seasonal carry at the next survey month even if its observation is missing', () => {
    const rows = [
      synthetic('2025-07', 'observed', '100'),
      ...months('2025-08', '2026-07').map((m) => synthetic(m, 'seasonal')),
    ];
    expect(resolvePrice(syntheticProduct, rows, '2026-05', false).age).toBe(10);
    expect(resolvePrice(syntheticProduct, rows, '2026-06', false).price).toBeNull();
    expect(resolvePrice(syntheticProduct, rows, '2026-07', false).price).toBeNull();
  });
  it('permits at most 11 off-season months', () => {
    const annual: Product = {
      ...syntheticProduct,
      segments: [{ ...syntheticProduct.segments[0], surveyMonths: [7] }],
    };
    const rows = [
      synthetic('2025-07', 'observed', '100'),
      ...months('2025-08', '2026-08').map((m) => synthetic(m, 'seasonal')),
    ];
    expect(resolvePrice(annual, rows, '2026-06', false)).toMatchObject({
      status: 'estimated',
      age: 11,
    });
    expect(resolvePrice(annual, rows, '2026-08', false).price).toBeNull();
  });
  it('never fills before the first observation, across an unknown gap or specification change', () => {
    expect(
      resolvePrice(syntheticProduct, [synthetic('2025-08', 'seasonal')], '2025-08', false).price,
    ).toBeNull();
    const rows = [
      synthetic('2025-07', 'observed', '100'),
      synthetic('2025-08', 'unavailable'),
      synthetic('2025-09', 'seasonal'),
    ];
    expect(resolvePrice(syntheticProduct, rows, '2025-09', false).price).toBeNull();
    const changed = {
      ...syntheticProduct,
      segments: [
        { ...syntheticProduct.segments[0], end: '2025-07' },
        { ...syntheticProduct.segments[0], id: 'synthetic-liquid', start: '2025-08' },
      ],
    };
    expect(
      resolvePrice(
        changed,
        [rows[0], { ...synthetic('2025-08', 'seasonal'), segmentId: 'synthetic-liquid' }],
        '2025-08',
        false,
      ).price,
    ).toBeNull();
  });
});

describe('compatible public baskets and source-based egg conversion', () => {
  const eggs = release.products.find((p) => p.id === 'mixed-size-eggs')!;
  const eggBasket: Basket = {
    ...basket,
    start: '2000-01',
    items: [{ productId: eggs.id, quantity: '10', unit: 'count' }],
  };
  it('keeps original kg observations and estimates count costs with the source 60g definition', () => {
    const results = evaluate(eggBasket, release, city());
    expect(results).toHaveLength(320);
    expect(results[0].items[0].price).toBe('302');
    expect(results[0].cost).toBe('181.2');
    expect(results[0].status).toBe('estimated');
    expect(results[0].items[0].reason).toBe('quantity-conversion');
    expect(results.at(-1)?.cost).toBe('321');
    expect(results.at(-1)?.change).not.toBeNull();
    expect(results.every((r) => r.cost !== null && r.comparable)).toBe(true);
    expect(results.filter((r) => r.items[0].reason === 'quantity-conversion')).toHaveLength(30);
    expect(evaluate(eggBasket, release, city(), true)[0].status).toBe('estimated');
    expect(results.find((r) => r.month === '2001-01')?.yoyEstimated).toBe(true);
    expect(results.find((r) => r.month === '2003-01')?.yoyEstimated).toBe(true);
    const migrated = evaluate(
      {
        ...eggBasket,
        start: '2026-08',
        items: [
          { productId: eggs.id, quantity: '16.666667', unit: 'count', quantityEstimated: true },
        ],
      },
      release,
      city(),
    );
    expect(migrated[0].status).toBe('estimated');
    expect(migrated[0].items[0].reason).toBe('quantity-assumption');
  });
  it('uses prior actual egg prices for six source market gaps without replacing raw absence', () => {
    for (const [cityId, period, anchor] of [
      ['01100', '2010-11', '2010-10'],
      ['04100', '2011-03', '2011-02'],
      ['45201', '2004-12', '2004-11'],
      ['45201', '2005-01', '2004-11'],
      ['35203-pre200510', '2004-01', '2003-12'],
      ['04202', '2011-03', '2011-02'],
    ]) {
      const sourceCity = city(cityId);
      const raw = sourceCity.series[eggs.id].find((r) => r.month === period)!;
      expect(raw.raw).toBe('-');
      expect(raw.status).toBe('unavailable');
      expect(raw.price).toBeNull();
      const actual = resolvePrice(eggs, sourceCity.series[eggs.id], period, false);
      expect(actual.status).toBe('estimated');
      expect(actual.reason).toBe('assumed-gap');
      expect(actual.anchor).toBe(anchor);
      expect(actual.price).toBe(sourceCity.series[eggs.id].find((r) => r.month === anchor)?.price);
      expect(resolvePrice(eggs, sourceCity.series[eggs.id], period, true).price).toBeNull();
    }
  });
  it('rejects missing-price assumptions past the cap, for unknown tokens, or across unresolved breaks', () => {
    const ruleProduct: Product = {
      ...syntheticProduct,
      missingPriceEstimate: { maxMonths: 2, tokens: ['-'], allowEquivalentSegments: true },
    };
    const rows = [
      synthetic('2024-01', 'observed', '100'),
      ...['2024-02', '2024-03', '2024-04'].map((m) => ({
        ...synthetic(m, 'unavailable'),
        raw: '-',
      })),
    ];
    expect(resolvePrice(ruleProduct, rows, '2024-03', false).price).toBe('100');
    expect(resolvePrice(ruleProduct, rows, '2024-04', false).price).toBeNull();
    expect(
      resolvePrice(ruleProduct, [rows[0], { ...rows[1], raw: '..' }], '2024-02', false).price,
    ).toBeNull();
    const later = {
      ...ruleProduct.segments[0],
      id: 'synthetic-later',
      start: '2024-02',
      continuityFromPrevious: false,
    };
    const changed = {
      ...ruleProduct,
      segments: [{ ...ruleProduct.segments[0], end: '2024-01' }, later],
    };
    expect(
      resolvePrice(changed, [rows[0], { ...rows[1], segmentId: later.id }], '2024-02', false).price,
    ).toBeNull();
    const equivalent = {
      ...changed,
      segments: [
        changed.segments[0],
        { ...later, continuityFromPrevious: true, quoteQuantity: '10', quoteUnit: 'kg' as const },
      ],
    };
    const carried = resolvePrice(
      equivalent,
      [rows[0], { ...rows[1], segmentId: later.id }],
      '2024-02',
      false,
    );
    expect(carried.segmentId).toBe('synthetic-segment');
    expect(quantityCost(carried.price!, '1', 'kg', equivalent, equivalent.segments[0])).toBe('100');
  });
  it('gates the whole city/period, continuity, inactive forms, estimates and retirement independently', () => {
    const tokyo = city();
    const eligible = release.products.filter(
      (p) => productEligibility(p, tokyo.series[p.id], release.start, release.end).eligible,
    );
    expect(eligible.length).toBeGreaterThan(50);
    expect(eligible.map((p) => p.id)).toContain(eggs.id);
    expect(
      productEligibility(eggs, tokyo.series[eggs.id], release.start, release.end).estimatedMonths,
    ).toBe(30);
    const detergent = release.products.find((p) => p.id === 'liquid-laundry-detergent')!;
    expect(
      productEligibility(detergent, tokyo.series[detergent.id], '2025-01', '2026-08').reason,
    ).toBe('retired-product');
    const rice = release.products.find((p) => p.id === 'koshihikari-rice')!;
    expect(
      productEligibility(rice, tokyo.series[rice.id], release.start, release.end).eligible,
    ).toBe(true);
    expect(productEligibility(rice, tokyo.series[rice.id], '2024-09', release.end).eligible).toBe(
      true,
    );
    expect(
      productEligibility(bread, city('14205').series[bread.id], release.start, release.end)
        .eligible,
    ).toBe(false);
    const mandarin = release.products.find((p) => p.id === 'satsuma-mandarins')!;
    expect(
      productEligibility(mandarin, tokyo.series[mandarin.id], '2025-09', release.end).eligible,
    ).toBe(true);
    expect(
      productEligibility(mandarin, tokyo.series[mandarin.id], '2025-09', release.end, true)
        .eligible,
    ).toBe(false);
  });
});
