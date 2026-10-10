import type { Product } from './contracts';
import { sourceBrandAliases } from './searchMetadata';

export type SearchRange = { start: string; end: string };

export function normalizeSearchText(text: string) {
  return text
    .normalize('NFKC')
    .replace(/[\u30a1-\u30f6]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0x60))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

type SearchIndex = { text: string; names: string[]; aliases: string[] };
const indexes = new WeakMap<Product, Map<string, SearchIndex>>();

function indexProduct(product: Product, range?: SearchRange): SearchIndex {
  const key = range ? `${range.start}:${range.end}` : 'archive';
  let cached = indexes.get(product);
  if (!cached) {
    cached = new Map();
    indexes.set(product, cached);
  }
  const previous = cached.get(key);
  if (previous) return previous;
  const segments = product.segments.filter(
    (segment) => !range || (segment.start <= range.end && segment.end >= range.start),
  );
  const definitions = normalizeSearchText(
    segments.map((segment) => `${segment.definition} ${segment.detail}`).join(' '),
  );
  const brands = sourceBrandAliases
    .filter((brand) =>
      brand.sourceForms.some((source) => definitions.includes(normalizeSearchText(source))),
    )
    .flatMap((brand) => [...brand.aliases]);
  const names = [product.names.en, product.names.ja].map(normalizeSearchText);
  const aliases = [...product.aliases, ...brands].map(normalizeSearchText);
  const index = {
    text: [product.code, ...names, ...aliases, definitions].join(' '),
    names,
    aliases,
  };
  // Long browser sessions can explore many windows; retain a bounded per-product cache.
  if (cached.size >= 8) cached.delete(cached.keys().next().value!);
  cached.set(key, index);
  return index;
}

/** Search generic survey identities, never manufacture a brand-specific price series. */
export function searchProducts(
  products: Product[],
  query: string,
  category: string,
  range?: SearchRange,
) {
  const term = normalizeSearchText(query);
  const words = term.split(' ').filter(Boolean);
  const matches = products.filter(
    (product) =>
      (category === 'all' || product.category === category) &&
      words.every((word) => indexProduct(product, range).text.includes(word)),
  );
  const rank = (product: Product) => {
    const index = indexProduct(product, range);
    return product.code === term
      ? 0
      : index.names.includes(term)
        ? 1
        : index.aliases.includes(term)
          ? 2
          : index.names.some((name) => name.startsWith(term))
            ? 3
            : 4;
  };
  return term ? matches.sort((a, b) => rank(a) - rank(b)) : matches;
}
