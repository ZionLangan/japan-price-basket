import type { Basket, CityData, Release } from './contracts';
import { months, productEligibility } from './domain';

export const DEFAULT_BASKET_SOURCE =
  'https://www.e-stat.go.jp/stat-search/files?layout=dataset&stat_infid=000040424635';

// Rounded monthly purchases from FIES 2025, two-or-more-person households.
// These selected survey products are category proxies, not an official CPI basket.
// Tofu uses an illustrative fixed mass; FIES reports blocks without their weight.
export const DEFAULT_BASKET_ITEMS: ReadonlyArray<Readonly<Basket['items'][number]>> = [
  { productId: 'koshihikari-rice', quantity: '5', unit: 'kg' },
  { productId: 'white-bread', quantity: '1.5', unit: 'kg' },
  { productId: 'domestic-pork', quantity: '2', unit: 'kg' },
  { productId: 'chicken-thigh', quantity: '1.5', unit: 'kg' },
  { productId: 'tuna', quantity: '150', unit: 'g' },
  { productId: 'momen-tofu', quantity: '2', unit: 'kg' },
  { productId: 'mixed-size-eggs', quantity: '40', unit: 'count' },
  { productId: 'carton-milk', quantity: '6', unit: 'L' },
  { productId: 'cabbage', quantity: '1.25', unit: 'kg' },
  { productId: 'onions', quantity: '1.2', unit: 'kg' },
  { productId: 'potatoes', quantity: '700', unit: 'g' },
  { productId: 'carrots', quantity: '600', unit: 'g' },
  { productId: 'bananas', quantity: '1.5', unit: 'kg' },
  { productId: 'cooking-oil', quantity: '600', unit: 'g' },
  { productId: 'soy-sauce', quantity: '300', unit: 'mL' },
  { productId: 'miso', quantity: '400', unit: 'g' },
];

export function createDefaultBasket(release: Release, cityId = '13100'): Basket {
  const city = release.cities.find((c) => c.id === cityId);
  if (!city) throw new Error('invalidBasket');
  return {
    schemaVersion: 1,
    name: 'Everyday staples / 日常の食材',
    cityId,
    start: city.start > release.start ? city.start : release.start,
    end: city.end < release.end ? city.end : release.end,
    items: DEFAULT_BASKET_ITEMS.map((item) => ({ ...item })),
  };
}

// Reset keeps the same goods and quantities in every city. A genuine gap can
// shorten the available interval; it must never silently remove a basket item.
export function defaultBasketForCity(release: Release, data: CityData, observedOnly: boolean) {
  const basket = createDefaultBasket(release, data.cityId);
  const products = basket.items.map((item) => {
    const product = release.products.find((p) => p.id === item.productId);
    if (!product || !product.units.includes(item.unit)) throw new Error('invalidBasket');
    return product;
  });
  let earliest = basket.start;
  for (const product of products) {
    for (const segment of product.segments) {
      if (
        !segment.continuityFromPrevious &&
        segment.start > earliest &&
        segment.start <= basket.end
      )
        earliest = segment.start;
    }
  }
  let start: string | undefined;
  for (const month of months(earliest, basket.end).reverse()) {
    if (
      products.some(
        (product) =>
          !productEligibility(product, data.series[product.id] ?? [], month, month, observedOnly)
            .eligible,
      )
    )
      break;
    start = month;
  }
  return {
    basket: start ? { ...basket, start } : basket,
    available: start !== undefined,
    rangeChanged: start !== undefined && start !== basket.start,
  };
}

// Upgrade only the untouched old Tokyo starter. Changed goods, quantities,
// dates, city or estimate preference indicate an existing visitor's selection.
export function isLegacyDefault(basket: Basket, release: Release, observedOnly: boolean) {
  const ids = ['white-bread', 'white-sugar', 'cabbage', 'potatoes', 'carrots'];
  return (
    !observedOnly &&
    basket.name === 'Staples / 基本食材' &&
    basket.cityId === '13100' &&
    basket.start === release.start &&
    basket.end === release.end &&
    basket.items.length === ids.length &&
    basket.items.every(
      (item, index) =>
        item.productId === ids[index] &&
        item.quantity === '1' &&
        item.unit === 'kg' &&
        !item.quantityEstimated,
    )
  );
}
