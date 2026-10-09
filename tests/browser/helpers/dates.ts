import { expect, type Page } from '@playwright/test';

export async function selectMonth(page: Page, endpoint: 'start' | 'end', value: string) {
  const [year, month] = value.split('-');
  await page.locator(`#${endpoint}-year`).selectOption(year);
  await page.locator(`#${endpoint}-month`).selectOption(month);
}

export async function expectRange(page: Page, start: string, end: string) {
  for (const [endpoint, value] of [
    ['start', start],
    ['end', end],
  ]) {
    const [year, month] = value.split('-');
    await expect(page.locator(`#${endpoint}-year`)).toHaveValue(year);
    await expect(page.locator(`#${endpoint}-month`)).toHaveValue(month);
  }
}
