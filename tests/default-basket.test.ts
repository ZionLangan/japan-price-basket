import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
  createDefaultBasket,
  defaultBasketForCity,
  DEFAULT_BASKET_ITEMS,
} from '../packages/domain/src/defaultBasket';
import { evaluate, productEligibility } from '../packages/domain/src/domain';
import { validateBasket, type Basket, type CityData } from '../packages/domain/src/contracts';
import { readState, writeState, type StoredState } from '../apps/web/src/storage';
import { city, release } from './fixture';

const tokyo = city();
const legacy: Basket = {
  schemaVersion: 1,
  name: 'Staples / 基本食材',
  cityId: '13100',
  start: release.start,
  end: release.end,
  items: ['white-bread', 'white-sugar', 'cabbage', 'potatoes', 'carrots'].map((productId) => ({
    productId,
    quantity: '1',
    unit: 'kg',
  })),
};

function storageFor(current: Basket, observedOnly = false) {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  } as Storage;
  const state: StoredState = {
    schemaVersion: 1,
    releaseId: release.releaseId,
    locale: 'ja',
    observedOnly,
    endMode: 'latest',
    current,
    saved: [{ ...legacy, name: 'My named record' }],
  };
  writeState(state, storage);
  return { storage, state };
}

describe('researched fixed staples basket', () => {
  it('keeps the same reviewed foods and quantities in every city and independent basket instance', () => {
    expect(DEFAULT_BASKET_ITEMS).toHaveLength(16);
    expect(new Set(DEFAULT_BASKET_ITEMS.map((item) => item.productId)).size).toBe(16);
    expect(DEFAULT_BASKET_ITEMS[0]).toEqual({
      productId: 'koshihikari-rice',
      quantity: '5',
      unit: 'kg',
    });
    for (const entry of release.cities) {
      const basket = createDefaultBasket(release, entry.id);
      expect(validateBasket(basket, release)).toEqual(basket);
      expect(basket.items).toEqual(DEFAULT_BASKET_ITEMS);
      expect(basket.start).toBe(entry.start > release.start ? entry.start : release.start);
      expect(basket.end).toBe(entry.end < release.end ? entry.end : release.end);
    }
    const changed = createDefaultBasket(release);
    changed.items[0].quantity = '10';
    expect(createDefaultBasket(release).items[0].quantity).toBe('5');
    expect(() => createDefaultBasket(release, '99999')).toThrow('invalidBasket');
  });

  it('reconciles native Tokyo endpoint prices and normalizes the dated quotes without rounding items', () => {
    const results = evaluate(createDefaultBasket(release), release, tokyo);
    expect(results).toHaveLength(320);
    expect(results.every((row) => row.cost !== null && row.comparable)).toBe(true);
    // Independent endpoint arithmetic from original quoted quantities:
    // rice 5922/10*5; pork235/100g*2000g; oil512/1500g*600g, etc.
    const initial = [
      2961, 633, 4700, 1755, 733.5, 680, 724.8, 1260, 200, 267.6, 196, 162.6, 352.5, 204.8, 90,
      143.2,
    ];
    const latest = [
      4326, 849, 6100, 2430, 870, 624, 1284, 1584, 280, 468, 382.9, 292.2, 537, 286, 206,
    ];
    expect(results[0].items.map((item) => Number(item.cost))).toEqual(initial);
    expect(results[0].cost).toBe('15064');
    expect(
      results
        .at(-1)!
        .items.slice(0, -1)
        .map((item) => Number(item.cost)),
    ).toEqual(latest);
    // The current miso quote is 425 yen/750 g; use an independent rational sum.
    const expected = latest
      .reduce((sum, value) => sum.plus(value), new Decimal(0))
      .plus(new Decimal(425).mul(400).div(750));
    expect(results.at(-1)!.cost).toBe(expected.toString());
    expect(new Decimal(results.at(-1)!.cost!).toDecimalPlaces(0).toString()).toBe('20746');
    expect(Number(results.at(-1)!.change)).toBeCloseTo(37.7175163746, 8);
    expect(results[0].items[6]).toMatchObject({
      status: 'estimated',
      reason: 'quantity-conversion',
      cost: '724.8',
    });
    expect(results.filter((row) => row.status === 'estimated')).toHaveLength(30);
    expect(results.at(-1)!.status).toBe('observed');
  });

  it('has complete current-city histories except the genuine Toyohashi survey interruption', () => {
    const products = DEFAULT_BASKET_ITEMS.map((item) =>
      release.products.find((p) => p.id === item.productId)!,
    );
    const incomplete: string[] = [];
    let from2000 = 0;
    for (const entry of release.cities.filter((c) => !c.historical)) {
      const data = city(entry.id);
      const basket = createDefaultBasket(release, entry.id);
      const usable = products.every(
        (product) =>
          productEligibility(product, data.series[product.id], basket.start, basket.end).eligible,
      );
      if (!usable) incomplete.push(entry.id);
      if (usable && basket.start === '2000-01') from2000++;
    }
    expect(incomplete).toEqual(['23201']);
    expect(from2000).toBe(59);
  }, 30000);

  it('resets Toyohashi to its latest common interval without removing foods or filling its survey gap', () => {
    const data = city('23201');
    const full = createDefaultBasket(release, data.cityId);
    expect(
      evaluate({ ...full, start: '2020-01', end: '2024-12' }, release, data).every(
        (r) => r.cost === null,
      ),
    ).toBe(true);
    const reset = defaultBasketForCity(release, data, false);
    expect(reset).toMatchObject({ available: true, rangeChanged: true });
    expect(reset.basket).toMatchObject({
      start: '2025-01',
      end: '2026-08',
      items: DEFAULT_BASKET_ITEMS,
    });
    expect(evaluate(reset.basket, release, data).every((r) => r.cost !== null)).toBe(true);
    expect(defaultBasketForCity(release, tokyo, false)).toMatchObject({
      available: true,
      rangeChanged: false,
      basket: createDefaultBasket(release),
    });
  });

  it('retains all foods when the latest month is absent, and starts after an unresolved break', () => {
    // Clearly synthetic policy fixtures; they never enter published data.
    const missing: CityData = {
      ...tokyo,
      series: {
        ...tokyo.series,
        tuna: tokyo.series.tuna.filter((row) => row.month !== release.end),
      },
    };
    expect(defaultBasketForCity(release, missing, false)).toEqual({
      basket: createDefaultBasket(release),
      available: false,
      rangeChanged: false,
    });
    const product = release.products.find((p) => p.id === 'tuna')!;
    const last = product.segments.at(-1)!;
    const broken = {
      ...release,
      products: release.products.map((p) =>
        p.id === product.id
          ? {
              ...p,
              segments: p.segments.map((segment) =>
                segment === last ? { ...segment, continuityFromPrevious: false } : segment,
              ),
            }
          : p,
      ),
    };
    const reset = defaultBasketForCity(broken, tokyo, false);
    expect(reset.basket.start).toBe(last.start);
    expect(reset.basket.items).toEqual(DEFAULT_BASKET_ITEMS);
    expect(reset.available).toBe(true);
    expect(reset.rangeChanged).toBe(true);
  });

  it('honors observed-only mode when the latest month would need a short-gap estimate', () => {
    // Synthetic temporary absence to exercise the selected estimate preference.
    const data: CityData = {
      ...tokyo,
      series: {
        ...tokyo.series,
        tuna: tokyo.series.tuna.map((row) =>
          row.month === release.end ? { ...row, status: 'temporary', price: null, raw: '-' } : row,
        ),
      },
    };
    expect(defaultBasketForCity(release, data, false).available).toBe(true);
    const strict = defaultBasketForCity(release, data, true);
    expect(strict.available).toBe(false);
    expect(strict.basket.items).toEqual(DEFAULT_BASKET_ITEMS);
  });
});

describe('default upgrade preserves visitors’ selections', () => {
  it('upgrades only the untouched legacy starter, preserving preferences and named records', () => {
    const { storage, state } = storageFor(legacy);
    const restored = readState(release, storage)!;
    expect(restored.current).toEqual(createDefaultBasket(release));
    expect(restored.migration).toEqual({
      removedDetergents: 0,
      convertedEggs: false,
      updatedDefault: true,
    });
    expect(restored.saved).toEqual(state.saved);
    expect(restored.locale).toBe('ja');
    expect(restored.endMode).toBe('latest');
    const { migration: _migration, ...persisted } = restored;
    writeState(persisted, storage);
    expect(readState(release, storage)).toEqual(persisted);
  });

  it('keeps edited quantities, units, goods, names, dates, cities and estimate preferences', () => {
    const edited: Basket[] = [
      {
        ...legacy,
        items: legacy.items.map((item, index) => (index === 0 ? { ...item, quantity: '2' } : item)),
      },
      {
        ...legacy,
        items: legacy.items.map((item, index) =>
          index === 0 ? { ...item, quantity: '1000', unit: 'g' } : item,
        ),
      },
      { ...legacy, items: legacy.items.slice(0, -1) },
      { ...legacy, name: 'My own staples' },
      { ...legacy, start: '2010-01' },
      { ...legacy, cityId: '27100' },
    ];
    for (const basket of edited) {
      const { storage } = storageFor(basket);
      expect(readState(release, storage)!.current).toEqual(basket);
      expect(readState(release, storage)!.migration).toBeUndefined();
    }
    const { storage: observed } = storageFor(legacy, true);
    expect(readState(release, observed)!.current).toEqual(legacy);
    const { storage: fixed, state } = storageFor({ ...legacy, end: '2025-12' });
    writeState({ ...state, endMode: 'fixed' }, fixed);
    expect(readState(release, fixed)!.current.end).toBe('2025-12');
    expect(readState(release, fixed)!.migration).toBeUndefined();
  });
});
