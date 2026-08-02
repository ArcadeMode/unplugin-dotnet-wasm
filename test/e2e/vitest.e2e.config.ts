import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const bundler = process.env.FIXTURE_BUNDLER ?? 'all';
const configName = `e2e-vitest-${bundler}-node-${process.platform}`;

// Node-platform E2E: executes built `dist/entry.js` artifacts and asserts their
// stdout. Browser E2E runs under Playwright (`playwright.config.ts`); the two
// never overlap because each runner owns a directory — Playwright drives
// `tests/playwright/`, vitest drives `tests/vitest/`.
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/vitest/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    maxWorkers: 1,
    reporters: ['default', 'junit'],
    outputFile: {
      junit: resolve(__dirname, `test-results/node/${bundler}/${configName}.junit.xml`),
    },
  },
});
