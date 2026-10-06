import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'apps/web',
  plugins: [react()],
  build: { outDir: '../../dist', emptyOutDir: true },
  test: { include: ['../../tests/*.test.ts'] },
});
