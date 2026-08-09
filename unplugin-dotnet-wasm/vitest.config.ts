import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@src': resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.spec.ts'],
    reporters: ['default', 'junit'],
    outputFile: {
      junit: resolve(import.meta.dirname, 'test-results/unit.junit.xml'),
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
});
