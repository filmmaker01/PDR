import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';
import swc from 'unplugin-swc';

export default defineConfig({
  // NestJS DI опирается на метаданные декораторов, esbuild их не генерирует.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    globals: true,
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup.ts'],
    hookTimeout: 120_000,
    testTimeout: 60_000,
    fileParallelism: false,
    pool: 'forks',
  },
});
