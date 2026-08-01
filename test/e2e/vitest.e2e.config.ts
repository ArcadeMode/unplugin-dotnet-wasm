import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Node-platform E2E: executes built `dist/entry.js` artifacts and asserts their
// stdout. Browser E2E runs under Playwright (`playwright.config.ts`); the two
// never overlap because each runner owns a directory — Playwright drives
// `tests/playwright/`, vitest drives `tests/vitest/`.
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/vitest/**/*.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    reporters: ['default', 'junit'],
    outputFile: {
      junit: resolve(__dirname, 'test-results/e2e-node.junit.xml'),
    },
  },
});
