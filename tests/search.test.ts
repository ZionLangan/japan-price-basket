import { describe, expect, it } from 'vitest';
import { searchProducts } from '../packages/domain/src/domain';
import { normalizeSearchText } from '../packages/domain/src/productSearch';
import { release } from './fixture';

const ids = (query: string, start = '2024-01', end = release.end) =>
  searchProducts(release.products, query, 'all', { start, end }).map((p) => p.id);

describe('reviewed bilingual search', () => {
  it('normalizes width, case, whitespace and equivalent kana readings', () => {
    expect(normalizeSearchText('  ＫＩＫＫＯＭＡＮ   ギュウニュウ ')).toBe('kikkoman ぎゅうにゅう');
    expect(normalizeSearchText('ｷﾞｭｳﾆｭｳ')).toBe('ぎゅうにゅう');
    const hiragana = ids('ぎゅうにゅう');
    expect(hiragana.length).toBeGreaterThan(0);
    expect(ids('ギュウニュウ')).toEqual(hiragana);
    expect(ids('ｷﾞｭｳﾆｭｳ')).toEqual(hiragana);
  });

  it('limits source-derived English brands to overlapping specification periods', () => {
    expect(ids('Yamasa')).not.toContain('soy-sauce');
    expect(ids('Yamasa')).toContain('men-tsuyu');
    expect(ids('Yamasa', '2023-01', '2023-12')).toContain('soy-sauce');
    expect(ids('Kikkoman')).toContain('soy-sauce');
    expect(ids('Kikkoman')).not.toContain('men-tsuyu');
    expect(ids('Kikkoman', '2016-01', '2016-02')).toContain('men-tsuyu');
    expect(ids('Kikkoman', '2016-03', '2016-03')).not.toContain('men-tsuyu');
    expect(ids('Yamasa', '2023-12', '2024-01')).toContain('soy-sauce');
  });

  it('accepts reviewed spelling alternatives without creating brand-specific products', () => {
    const mayonnaise = release.products.find((p) => p.id === 'mayonnaise')!;
    expect(ids('Kewpie')).toContain(mayonnaise.id);
    expect(ids('キユーピー')).toContain(mayonnaise.id);
    expect(ids('キューピー', '2000-01', '2000-01')).toContain(mayonnaise.id);
    expect(ids('Kewpie', '2000-01', '2000-01')).toContain(mayonnaise.id);
    expect(ids('Kewpie')).toContain('sesame-dressing');
    expect(mayonnaise.names.en).toBe('Mayonnaise');
    expect(mayonnaise.names.ja).toBe('マヨネーズ');
  });

  it('keeps complete archive search compatible while exact item codes rank first', () => {
    expect(searchProducts(release.products, 'Yamasa', 'all').map((p) => p.id)).toContain(
      'soy-sauce',
    );
    const product = release.products.find((p) => p.id === 'soy-sauce')!;
    expect(
      searchProducts(release.products, product.code, 'food', {
        start: '2024-01',
        end: release.end,
      })[0].id,
    ).toBe(product.id);
    expect(
      searchProducts(release.products, 'Kikkoman', 'household', {
        start: '2024-01',
        end: release.end,
      }),
    ).toEqual([]);
  });

  it('searches actual Japanese specification terms and requires every query word', () => {
    expect(ids('いつでも新鮮')).toContain('soy-sauce');
    expect(ids('Kikkoman いつでも新鮮')).toContain('soy-sauce');
    expect(ids('Kikkoman does-not-exist')).toEqual([]);
    expect(ids('いつでも新鮮', '2000-01', '2000-12')).not.toContain('soy-sauce');
  });
});
