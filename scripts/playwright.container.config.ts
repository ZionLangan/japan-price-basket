import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const baseURL = process.env.CONTAINER_URL ?? 'http://127.0.0.1:8080';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL)) throw new Error('Container tests require a loopback HTTP origin');

export default defineConfig({
  testDir: '.',
  testMatch: 'container-smoke.spec.ts',
  outputDir: fileURLToPath(new URL('../test-results/container', import.meta.url)),
  timeout: 90_000,
  retries: 0,
  workers: 1,
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    { name: 'container-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'container-mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
    { name: 'container-firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'container-webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
