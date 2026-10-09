import { describe, expect, it } from 'vitest';
import {
  evaluate,
  quantityCost,
  convertQuantity,
  resolvePrice,
  searchProducts,
  months,
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
