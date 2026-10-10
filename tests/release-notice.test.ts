import { expect, it } from 'vitest';
import {
  acknowledgeReleaseNotice,
  readState,
  writeState,
  type StoredState,
} from '../apps/web/src/storage';
import { release } from './fixture';

const key = 'japan-basket-prices:v1';
const basket: StoredState['current'] = {
  schemaVersion: 1,
  name: 'Personal selection',
  cityId: '13100',
  start: '2026-01',
  end: '2026-07',
  items: [{ productId: 'white-bread', quantity: '0.5', unit: 'kg' }],
};
const state: StoredState = {
  schemaVersion: 1,
  releaseId: 'previous-reviewed-release',
  releaseEnd: '2026-07',
  locale: 'ja',
  observedOnly: true,
  endMode: 'fixed',
  current: basket,
  saved: [{ ...basket, name: 'Named selection' }],
};
function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, value: string) => {
      values.set(k, value);
    },
  } as Storage;
}

it('records a changed data release without changing fixed selections or named baskets', () => {
  const storage = memoryStorage();
  writeState(state, storage);
  const original = storage.getItem(key);
  const restored = readState(release, storage)!;
  expect(restored).toMatchObject({
    releaseId: release.releaseId,
    releaseEnd: release.end,
    locale: state.locale,
    observedOnly: state.observedOnly,
    current: state.current,
    saved: state.saved,
    pendingReleaseNotice: {
      fromReleaseId: state.releaseId,
      toReleaseId: release.releaseId,
      previousEnd: state.releaseEnd,
      nextEnd: release.end,
      advancedLatest: false,
    },
  });
  expect(storage.getItem(key)).toBe(original);
});

it('records advancing Now while preserving saved fixed periods and quantities', () => {
  const storage = memoryStorage();
  writeState({ ...state, endMode: 'latest' }, storage);
  const restored = readState(release, storage)!;
  expect(restored.current).toEqual({ ...basket, end: release.end });
  expect(restored.saved).toEqual(state.saved);
  expect(restored.pendingReleaseNotice?.advancedLatest).toBe(true);
});

it('keeps a pending release notice across reloads until explicitly acknowledged', () => {
  const storage = memoryStorage();
  writeState(state, storage);
  const changed = readState(release, storage)!;
  writeState(changed, storage);
  const reload = readState(release, storage)!;
  expect(reload.pendingReleaseNotice).toEqual(changed.pendingReleaseNotice);
  const acknowledged = acknowledgeReleaseNotice(reload);
  expect(acknowledged.pendingReleaseNotice).toBeUndefined();
  expect(reload.pendingReleaseNotice).toEqual(changed.pendingReleaseNotice);
  writeState(acknowledged, storage);
  expect(readState(release, storage)).toEqual(acknowledged);
  expect(
    readState({ ...release, releaseId: 'another-reviewed-release' }, storage)?.pendingReleaseNotice,
  ).toMatchObject({
    fromReleaseId: release.releaseId,
    toReleaseId: 'another-reviewed-release',
  });
});

it('coalesces unacknowledged releases while preserving the oldest known cutoff', () => {
  const storage = memoryStorage();
  writeState(state, storage);
  writeState(readState(release, storage)!, storage);
  const newer = { ...release, releaseId: 'another-reviewed-release', end: '2026-09' };
  const updated = readState(newer, storage)!;
  expect(updated.pendingReleaseNotice).toEqual({
    fromReleaseId: state.releaseId,
    toReleaseId: newer.releaseId,
    previousEnd: '2026-07',
    nextEnd: '2026-09',
    advancedLatest: false,
  });
  expect(updated.current).toEqual(basket);
  expect(updated.saved).toEqual(state.saved);
});

it('does not invent a release cutoff from a legacy basket range or a later release', () => {
  const storage = memoryStorage();
  const { releaseEnd: _end, ...legacy } = state;
  writeState(legacy, storage);
  const restored = readState(release, storage)!;
  expect(restored.pendingReleaseNotice).not.toHaveProperty('previousEnd');
  writeState(restored, storage);
  expect(
    readState({ ...release, releaseId: 'next-reviewed-release' }, storage)?.pendingReleaseNotice,
  ).not.toHaveProperty('previousEnd');
});

it('reads older same-release state without creating a notice or dropping fields', () => {
  const storage = memoryStorage();
  const { releaseEnd: _end, ...legacy } = { ...state, releaseId: release.releaseId };
  writeState(legacy, storage);
  expect(readState(release, storage)).toEqual(legacy);
});

it('rejects malformed or oversized pending metadata without altering the original record', () => {
  const valid = {
    fromReleaseId: state.releaseId,
    toReleaseId: release.releaseId,
    nextEnd: release.end,
    advancedLatest: false,
  };
  for (const notice of [
    { ...valid, fromReleaseId: 'x'.repeat(129) },
    { ...valid, nextEnd: '2026-13' },
    { ...valid, advancedLatest: 'yes' },
    { ...valid, extra: 'untrusted' },
  ]) {
    const storage = memoryStorage();
    const raw = JSON.stringify({ ...state, pendingReleaseNotice: notice });
    storage.setItem(key, raw);
    expect(() => readState(release, storage)).toThrow('storageInvalid');
    expect(storage.getItem(key)).toBe(raw);
  }
});
