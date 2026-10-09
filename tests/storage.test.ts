import { expect, it } from 'vitest';
import { readState, writeState, parseImport, type StoredState } from '../apps/web/src/storage';
import { makeCsv } from '../apps/web/src/downloads';
import { evaluate } from '../packages/domain/src/domain';
import { city, release } from './fixture';

const current: StoredState['current'] = {
  schemaVersion: 1,
  name: '=unsafe-name',
  cityId: '13100',
  start: '2026-01',
  end: '2026-08',
  items: [{ productId: 'white-bread', quantity: '0.5', unit: 'kg' }],
};
const state: StoredState = {
  schemaVersion: 1,
  releaseId: release.releaseId,
  locale: 'ja',
  observedOnly: true,
  current,
  saved: [current],
};
const memoryStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  } as Storage;
};
it('round-trips local basket and language without altering quantities', () => {
  const storage = memoryStorage();
  writeState(state, storage);
  expect(readState(release, storage)).toEqual(state);
});
it('removes requested detergents from the live basket while preserving named records', () => {
  const storage = memoryStorage();
  const detergent = { productId: 'powder-laundry-detergent', quantity: '1', unit: 'kg' as const };
  const legacy = { ...current, items: [...current.items, detergent] };
  writeState({ ...state, current: legacy, saved: [legacy] }, storage);
  const restored = readState(release, storage)!;
  expect(restored.current.items).toEqual(current.items);
  expect(restored.saved[0].items).toEqual(legacy.items);
  expect(restored.migration).toEqual({ removedDetergents: 1, convertedEggs: false });
  expect(restored.locale).toBe('ja');
  expect(restored.observedOnly).toBe(true);
});
it('migrates and combines old egg forms without losing an estimated quantity on reload', () => {
  const storage = memoryStorage();
  const legacy = {
    ...current,
    items: [
      current.items[0],
      { productId: 'eggs-by-weight', quantity: '1', unit: 'kg' as const },
      { productId: 'large-size-eggs', quantity: '6', unit: 'count' as const },
      { productId: 'mixed-size-eggs', quantity: '10', unit: 'count' as const },
    ],
  };
  writeState({ ...state, current: legacy, saved: [legacy] }, storage);
  const restored = readState(release, storage)!;
  expect(restored.current.items).toEqual([
    current.items[0],
    { productId: 'mixed-size-eggs', quantity: '32.666667', unit: 'count', quantityEstimated: true },
  ]);
  expect(restored.saved[0].items).toEqual(restored.current.items);
  expect(restored.current.name).toBe(current.name);
  expect(restored.current.start).toBe(current.start);
  expect(restored.migration?.convertedEggs).toBe(true);
  const { migration: _migration, ...persisted } = restored;
  writeState(persisted, storage);
  expect(readState(release, storage)?.current.items).toEqual(restored.current.items);
});
it('uses grams and preserves exact count quantities for the old egg variants', () => {
  for (const [productId, quantity, unit, expected, estimated] of [
    ['eggs-by-weight', '180', 'g', '3', true],
    ['large-size-eggs', '6', 'count', '6', false],
  ] as const) {
    const storage = memoryStorage();
    writeState(
      { ...state, current: { ...current, items: [{ productId, quantity, unit }] } },
      storage,
    );
    const item = readState(release, storage)!.current.items[0];
    expect(item).toMatchObject({ productId: 'mixed-size-eggs', quantity: expected, unit: 'count' });
    expect(Boolean(item.quantityEstimated)).toBe(estimated);
  }
});
it('does not treat duplicate original egg rows as an authorized migration', () => {
  const storage = memoryStorage();
  const item = { productId: 'mixed-size-eggs', quantity: '6', unit: 'count' as const };
  const raw = JSON.stringify({ ...state, current: { ...current, items: [item, item] } });
  storage.setItem('japan-basket-prices:v1', raw);
  expect(() => readState(release, storage)).toThrow('storageInvalid');
  expect(storage.getItem('japan-basket-prices:v1')).toBe(raw);
});
it('advances an explicit latest end on a new release while fixed and legacy ends stay fixed', () => {
  const nextRelease = { ...release, end: '2026-09' };
  for (const endMode of ['latest', 'fixed', undefined] as const) {
    const storage = memoryStorage();
    writeState({ ...state, endMode }, storage);
    const restored = readState(nextRelease, storage)!;
    expect(restored.current.end).toBe(endMode === 'latest' ? '2026-09' : '2026-08');
    expect(restored.current.start).toBe('2026-01');
    expect(restored.current.items).toEqual(current.items);
    expect(restored.saved[0].end).toBe('2026-08');
  }
});
it('rejects an unknown end mode without silently changing the stored record', () => {
  const storage = memoryStorage();
  const value = JSON.stringify({ ...state, endMode: 'today' });
  storage.setItem('japan-basket-prices:v1', value);
  expect(() => readState(release, storage)).toThrow('storageInvalid');
  expect(storage.getItem('japan-basket-prices:v1')).toBe(value);
});
it('rejects corrupt, oversized and incompatible imports without mutating a basket', () => {
  for (const text of [
    '{}',
    '{',
    ' '.repeat(65537),
    JSON.stringify({ ...current, cityId: '99999' }),
    JSON.stringify({ ...current, items: [...current.items, ...current.items] }),
    JSON.stringify({ ...current, unexpected: true }),
  ])
    expect(() => parseImport(text, release)).toThrow();
  expect(current.items[0].quantity).toBe('0.5');
});
it('exports status, anchors, source and selection; protects CSV formula cells', () => {
  const csv = makeCsv(current, release, evaluate(current, release, city()));
  expect(csv).toContain('actual_anchor_month');
  expect(csv).toContain('source_url');
  expect(csv).toContain("'=unsafe-name");
  expect(csv).toContain('"0.5","kg"');
  expect(csv).toContain('file-download?statInfId=');
  const tabbed = makeCsv(
    { ...current, name: '\t=unsafe-name' },
    release,
    evaluate(current, release, city()),
  );
  expect(tabbed).toContain("'\t=unsafe-name");
});
