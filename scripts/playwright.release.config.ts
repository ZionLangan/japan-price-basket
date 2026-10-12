import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import original from '../playwright.config';

const root = fileURLToPath(new URL('../', import.meta.url));

// Reuses the entire existing suite against the exact release-base build. The test
// harness supplies root aliases for fixture requests, not for production delivery.
export default defineConfig({
  ...original,
  // Full-history browser pages load sizable per-city data; cap concurrent pages.
  workers: 4,
  testDir: '../tests/browser',
  outputDir: `${root}/test-results/release`,
  webServer: {
    command: 'node scripts/serve-test-artifact.mjs',
    cwd: root,
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
