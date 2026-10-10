import type { Page } from '@playwright/test';

/** Keep price and chart regression fixtures independent of the public default basket. */
export async function seedAuditedBasket(page: Page) {
  await page.addInitScript(() => {
    const key = 'japan-basket-prices:v1';
    if (localStorage.getItem(key) !== null) return;
    localStorage.setItem(
      key,
      JSON.stringify({
        schemaVersion: 1,
        releaseId: 'rps-test-independent',
        locale: 'en',
        observedOnly: false,
        endMode: 'latest',
        saved: [],
        current: {
          schemaVersion: 1,
          name: 'Audited five-staple test',
          cityId: '13100',
          start: '2000-01',
          end: '2026-08',
          items: ['white-bread', 'white-sugar', 'cabbage', 'potatoes', 'carrots'].map(
            (productId) => ({ productId, quantity: '1', unit: 'kg' }),
          ),
        },
      }),
    );
  });
}
