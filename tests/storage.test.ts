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
