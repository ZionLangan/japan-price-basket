import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'apps/web',
  plugins: [react()],
  build: { outDir: '../../dist', emptyOutDir: true },
  // Full-history suites index a 1.2 GB archive; bound concurrent worker memory.
  test: { include: ['../../tests/*.test.ts'], maxWorkers: 2 },
});
