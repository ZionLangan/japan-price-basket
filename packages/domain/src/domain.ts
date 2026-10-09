import Decimal from 'decimal.js';
import type { Basket, CityData, Observation, Product, Release } from './contracts';

Decimal.set({ precision: 32, rounding: Decimal.ROUND_HALF_UP });
export type Status = 'observed' | 'estimated' | 'unavailable';
export type ItemValue = {
  productId: string;
  month: string;
  cost: string | null;
  price: string | null;
  status: Status;
  reason: string;
  anchor: string | null;
  age: number;
  segmentId: string;
  sourceId: string;
  sourceUnit: string;
  sourceRow: number;
  sourceColumn: number | null;
  sourceSheet: string;
};
export type Result = {
  month: string;
  cost: string | null;
  status: Status;
  items: ItemValue[];
  change: string | null;
  index: string | null;
  comparable: boolean;
  yoy: string | null;
  yoyEstimated: boolean;
  contributions: Record<string, string | null>;
};
export const monthNumber = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5)) - 1;
export function months(start: string, end: string): string[] {
  const result: string[] = [];
  for (let n = monthNumber(start); n <= monthNumber(end); n++)
    result.push(`${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`);
  return result;
}
const measures: Record<string, { dimension: string; factor: string }> = {
  kg: { dimension: 'mass', factor: '1000' },
  g: { dimension: 'mass', factor: '1' },
  L: { dimension: 'volume', factor: '1000' },
  mL: { dimension: 'volume', factor: '1' },
  package: { dimension: 'package', factor: '1' },
  count: { dimension: 'count', factor: '1' },
  m: { dimension: 'length', factor: '1' },
  pair: { dimension: 'pair', factor: '1' },
  cut: { dimension: 'cut', factor: '1' },
};
export function quantityCost(
  price: string,
  quantity: string,
  unit: string,
  product: Product,
  segment?: Product['segments'][number],
) {
  const quoteUnit = segment?.quoteUnit ?? product.unit;
  const quoteQuantity = segment?.quoteQuantity ?? product.quoteQuantity;
  if (
    !product.units.includes(unit as Product['unit']) ||
    !measures[unit] ||
    measures[unit].dimension !== measures[product.unit].dimension ||
    measures[quoteUnit].dimension !== measures[product.unit].dimension
  )
    throw new Error('invalidUnit');
  return new Decimal(price)
    .mul(quantity)
    .mul(measures[unit].factor)
    .div(new Decimal(quoteQuantity).mul(measures[quoteUnit].factor))
    .toString();
}
export function convertQuantity(quantity: string, from: string, to: string) {
  if (!measures[from] || !measures[to] || measures[from].dimension !== measures[to].dimension)
    throw new Error('invalidUnit');
  return new Decimal(quantity).mul(measures[from].factor).div(measures[to].factor).toString();
}
export function resolvePrice(
  product: Product,
  rows: Observation[],
  month: string,
  observedOnly: boolean,
): Omit<ItemValue, 'cost' | 'productId'> {
  const segment = product.segments.find((s) => s.start <= month && s.end >= month);
  const row = rows.find((r) => r.month === month);
  const absent = {
    month,
    price: null,
    status: 'unavailable' as const,
    reason: !segment ? 'variant-inactive' : (row?.status ?? 'not-surveyed'),
    anchor: null,
    age: 0,
    segmentId: segment?.id ?? '',
    sourceId: row?.sourceId ?? '',
    sourceUnit: row?.sourceUnit ?? '',
    sourceRow: row?.sourceRow ?? 0,
    sourceColumn: row?.sourceColumn ?? null,
    sourceSheet: row?.sourceSheet ?? '',
  };
  if (!segment || !row || row.segmentId !== segment.id) return absent;
  if (row.status === 'observed' && row.price !== null)
    return {
      ...absent,
      price: row.price,
      status: 'observed',
      reason: 'observed',
      anchor: month,
    };
  if (observedOnly || !['seasonal', 'temporary'].includes(row.status)) return absent;
  const anchor = rows
    .filter(
      (r) =>
        r.month < month &&
        r.status === 'observed' &&
        r.price !== null &&
        r.segmentId === segment.id &&
        r.month >= segment.start,
    )
    .sort((a, b) => b.month.localeCompare(a.month))[0];
  if (!anchor) return absent;
  const age = monthNumber(month) - monthNumber(anchor.month);
  const intervening = months(anchor.month, month)
    .slice(1)
    .map((m) => rows.find((r) => r.month === m));
  if (row.status === 'temporary') {
    if (
      age > 2 ||
      intervening.some((r) => !r || r.status !== 'temporary' || r.segmentId !== segment.id)
    )
      return absent;
  } else {
    // Cannot carry through a new survey season, an unknown gap, or another segment.
    if (
      age > 11 ||
      intervening.some(
        (r) =>
          !r ||
          r.status !== 'seasonal' ||
          r.segmentId !== segment.id ||
          segment.surveyMonths.includes(Number(r.month.slice(5))),
      )
    )
      return absent;
  }
  return {
    ...absent,
    status: 'estimated',
    price: anchor.price,
    reason: row.status,
    anchor: anchor.month,
    age,
    sourceId: anchor.sourceId,
    sourceUnit: anchor.sourceUnit,
    sourceRow: anchor.sourceRow,
    sourceColumn: anchor.sourceColumn ?? null,
    sourceSheet: anchor.sourceSheet,
  };
}
export function hasBreak(product: Product, start: string, end: string) {
  return product.segments.some(
    (s) => s.start > start && s.start <= end && !s.continuityFromPrevious,
  );
}
export function evaluate(
  basket: Basket,
  release: Release,
  city: CityData,
  observedOnly = false,
): Result[] {
  if (
    city.releaseId !== release.releaseId ||
    city.cityId !== basket.cityId ||
    city.scopeId !== basket.cityId
  )
    throw new Error('mismatchedRelease');
  const products = basket.items.map((i) => release.products.find((p) => p.id === i.productId)!);
  const results: Result[] = months(basket.start, basket.end).map((month) => {
    const items = basket.items.map((item, i): ItemValue => {
      const value = resolvePrice(
        products[i],
        city.series[item.productId] ?? [],
        month,
        observedOnly,
      );
      return {
        ...value,
        productId: item.productId,
        cost:
          value.price === null
            ? null
            : quantityCost(
                value.price,
                item.quantity,
                item.unit,
                products[i],
                products[i].segments.find((s) => s.id === value.segmentId),
              ),
      };
    });
    const status: Status =
      !items.length || items.some((i) => i.cost === null)
        ? 'unavailable'
        : items.some((i) => i.status === 'estimated')
          ? 'estimated'
          : 'observed';
    return {
      month,
      items,
      status,
      cost:
        status === 'unavailable'
          ? null
          : items.reduce((sum, i) => sum.plus(i.cost!), new Decimal(0)).toString(),
      change: null,
      index: null,
      comparable: !products.some((p) => hasBreak(p, basket.start, month)),
      yoy: null,
      yoyEstimated: false,
      contributions: {},
    };
  });
  const baseline = results[0]?.cost;
  if (baseline !== null && baseline !== undefined && new Decimal(baseline).gt(0)) {
    for (const row of results)
      if (row.cost !== null && row.comparable) {
        row.index = new Decimal(row.cost).div(baseline).mul(100).toString();
        row.change = new Decimal(row.index).minus(100).toString();
      }
  }
  for (const row of results) {
    for (const item of row.items) {
      const baseItem = results[0]?.items.find((i) => i.productId === item.productId);
      const product = products.find((p) => p.id === item.productId)!;
      row.contributions[item.productId] =
        item.cost !== null && baseItem?.cost != null && !hasBreak(product, basket.start, row.month)
          ? new Decimal(item.cost).minus(baseItem.cost).toString()
          : null;
    }
    const yearAgo = `${Number(row.month.slice(0, 4)) - 1}${row.month.slice(4)}`;
    if (
      yearAgo < release.start ||
      products.some((p) => hasBreak(p, yearAgo, row.month)) ||
      row.cost === null
    )
      continue;
    const priorItems = basket.items.map((item, i) => {
      const value = resolvePrice(
        products[i],
        city.series[item.productId] ?? [],
        yearAgo,
        observedOnly,
      );
      return {
        value,
        cost:
          value.price === null
            ? null
            : quantityCost(
                value.price,
                item.quantity,
                item.unit,
                products[i],
                products[i].segments.find((s) => s.id === value.segmentId),
              ),
      };
    });
    if (priorItems.some((i) => i.cost === null) || !priorItems.length) continue;
    const priorCost = priorItems.reduce((sum, i) => sum.plus(i.cost!), new Decimal(0));
    if (priorCost.gt(0)) {
      row.yoy = new Decimal(row.cost).div(priorCost).minus(1).mul(100).toString();
      row.yoyEstimated =
        row.status === 'estimated' || priorItems.some((i) => i.value.status === 'estimated');
    }
  }
  return results;
}
export function searchProducts(products: Product[], query: string, category: string) {
  const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase().trim();
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const matches = products.filter(
    (p) =>
      (category === 'all' || p.category === category) &&
      words.every((w) =>
        normalize([p.names.en, p.names.ja, p.code, ...p.aliases].join(' ')).includes(w),
      ),
  );
  const term = normalize(query);
  const rank = (p: Product) =>
    p.code === term
      ? 0
      : [p.names.en, p.names.ja].some((n) => normalize(n) === term)
        ? 1
        : p.aliases.some((n) => normalize(n) === term)
          ? 2
          : [p.names.en, p.names.ja].some((n) => normalize(n).startsWith(term))
            ? 3
            : 4;
  return term ? matches.sort((a, b) => rank(a) - rank(b)) : matches;
}
