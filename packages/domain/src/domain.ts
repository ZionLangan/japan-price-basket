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
  changeYen: string | null;
  index: string | null;
  observedCount: number;
  estimatedCount: number;
  unavailableCount: number;
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
  const conversion = segment?.quantityConversion;
  if (
    !product.units.includes(unit as Product['unit']) ||
    !measures[unit] ||
    measures[unit].dimension !== measures[product.unit].dimension ||
    (conversion
      ? conversion.from !== product.unit ||
        measures[conversion.to].dimension !== measures[quoteUnit].dimension
      : measures[quoteUnit].dimension !== measures[product.unit].dimension)
  )
    throw new Error('invalidUnit');
  const quotedMeasure = conversion
    ? new Decimal(quantity)
        .mul(measures[unit].factor)
        .div(measures[product.unit].factor)
        .mul(conversion.factor)
        .mul(measures[conversion.to].factor)
    : new Decimal(quantity).mul(measures[unit].factor);
  return new Decimal(price)
    .mul(quotedMeasure)
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
  const activeSegment = (period: string) =>
    product.segments.find((s) => s.start <= period && s.end >= period);
  const segment = activeSegment(month);
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
  const assumption = product.missingPriceEstimate;
  const assumedGap =
    row.status === 'unavailable' && assumption?.tokens.includes(String(row.raw).trim());
  if (observedOnly || (!assumedGap && !['seasonal', 'temporary'].includes(row.status)))
    return absent;
  const anchor = rows
    .filter(
      (r) =>
        r.month < month &&
        r.status === 'observed' &&
        r.price !== null &&
        activeSegment(r.month)?.id === r.segmentId &&
        (r.segmentId === segment.id ||
          ((!assumedGap || assumption?.allowEquivalentSegments) &&
            !hasBreak(product, r.month, month))),
    )
    .sort((a, b) => b.month.localeCompare(a.month))[0];
  if (!anchor) return absent;
  const age = monthNumber(month) - monthNumber(anchor.month);
  const intervening = months(anchor.month, month)
    .slice(1)
    .map((m) => rows.find((r) => r.month === m));
  // Approved definition changes may join generic goods, but inactive months and
  // unresolved changes cannot supply an estimate. Keep the anchor's native quote.
  if (
    intervening.some(
      (r) =>
        !r ||
        activeSegment(r.month)?.id !== r.segmentId ||
        hasBreak(product, anchor.month, r.month),
    )
  )
    return absent;
  if (assumedGap && assumption) {
    if (
      age > assumption.maxMonths ||
      intervening.some(
        (r) =>
          !r ||
          r.status !== 'unavailable' ||
          !assumption.tokens.includes(String(r.raw).trim()) ||
          (!assumption.allowEquivalentSegments && r.segmentId !== anchor.segmentId) ||
          hasBreak(product, anchor.month, r.month),
      )
    )
      return absent;
  } else if (row.status === 'temporary') {
    if (age > 2 || intervening.some((r) => !r || r.status !== 'temporary')) return absent;
  } else {
    // Use each month's dated calendar, including at approved definition changes.
    // A fresh season requires a new actual price; unknown gaps remain unavailable.
    if (
      age > 11 ||
      !activeSegment(anchor.month)?.surveyMonths.includes(Number(anchor.month.slice(5))) ||
      intervening.some(
        (r) =>
          !r ||
          r.status !== 'seasonal' ||
          activeSegment(r.month)!.surveyMonths.includes(Number(r.month.slice(5))),
      )
    )
      return absent;
  }
  return {
    ...absent,
    status: 'estimated',
    price: anchor.price,
    reason: assumedGap ? 'assumed-gap' : row.status,
    anchor: anchor.month,
    age,
    segmentId: anchor.segmentId,
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
function pricedItem(
  product: Product,
  rows: Observation[],
  month: string,
  quantity: string,
  unit: string,
  observedOnly: boolean,
  quantityEstimated = false,
): ItemValue {
  const value = resolvePrice(product, rows, month, observedOnly);
  const segment = product.segments.find((s) => s.id === value.segmentId);
  const converted = segment?.quantityConversion?.estimated;
  const estimatedQuantity = value.price !== null && (converted || quantityEstimated);
  return {
    ...value,
    productId: product.id,
    status: estimatedQuantity ? 'estimated' : value.status,
    reason:
      estimatedQuantity && value.reason === 'observed'
        ? quantityEstimated
          ? 'quantity-assumption'
          : 'quantity-conversion'
        : value.reason,
    cost: value.price === null ? null : quantityCost(value.price, quantity, unit, product, segment),
  };
}
export function productEligibility(
  product: Product,
  rows: Observation[],
  start: string,
  end: string,
  observedOnly = false,
): { eligible: boolean; reason: string; firstUnavailable: string | null; estimatedMonths: number } {
  const rejected = (reason: string, firstUnavailable: string | null = null) => ({
    eligible: false,
    reason,
    firstUnavailable,
    estimatedMonths: 0,
  });
  if (product.selectable === false) return rejected('retired-product');
  if (start > end) return rejected('invalid-range');
  if (hasBreak(product, start, end))
    return rejected(
      'specification-break',
      product.segments.find((s) => s.start > start && s.start <= end && !s.continuityFromPrevious)!
        .start,
    );
  let estimatedMonths = 0;
  for (const month of months(start, end)) {
    const value = pricedItem(product, rows, month, '1', product.unit, observedOnly);
    if (value.cost === null) return rejected(value.reason, month);
    if (value.status === 'estimated') estimatedMonths++;
  }
  return { eligible: true, reason: '', firstUnavailable: null, estimatedMonths };
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
      return pricedItem(
        products[i],
        city.series[item.productId] ?? [],
        month,
        item.quantity,
        item.unit,
        observedOnly,
        item.quantityEstimated,
      );
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
      changeYen: null,
      index: null,
      observedCount: items.filter((item) => item.status === 'observed').length,
      estimatedCount: items.filter((item) => item.status === 'estimated').length,
      unavailableCount: items.filter((item) => item.status === 'unavailable').length,
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
        row.changeYen = new Decimal(row.cost).minus(baseline).toString();
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
      const value = pricedItem(
        products[i],
        city.series[item.productId] ?? [],
        yearAgo,
        item.quantity,
        item.unit,
        observedOnly,
        item.quantityEstimated,
      );
      return { value, cost: value.cost };
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
export { searchProducts } from './productSearch';
