import { expect, it } from 'vitest';
import { sourceDownloadWindow } from '../apps/web/src/DataSource';
import type { Release } from '../packages/domain/src/contracts';

// Synthetic metadata only; no synthetic prices are published.
const metadata = (dates: string[]) =>
  ({
    builtAt: '2040-01-01T00:00:00Z',
    sources: dates.map((retrievedAt) => ({ retrievedAt })),
  }) as Release;

it('uses source retrieval timestamps independently of the legacy builtAt field', () => {
  expect(
    sourceDownloadWindow(
      metadata(['2026-10-09T23:18:14.828539+00:00', '2026-10-06T08:43:11.275603+00:00']),
    ),
  ).toEqual({
    first: Date.parse('2026-10-06T08:43:11.275603+00:00'),
    last: Date.parse('2026-10-09T23:18:14.828539+00:00'),
  });
});

it('does not invent freshness when retrieval metadata is missing or invalid', () => {
  expect(sourceDownloadWindow(metadata([]))).toBeNull();
  expect(sourceDownloadWindow(metadata(['unknown']))).toBeNull();
});
