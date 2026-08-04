import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const bundler = process.env.FIXTURE_BUNDLER ?? 'all';
const configName = `e2e-playwright-${bundler}-browser-${process.platform}`;

export default defineConfig({
  testDir: 'tests/playwright',
  globalSetup: './setup/playwright-global-setup.ts',
  globalTeardown: './setup/playwright-global-teardown.ts',
  // .NET restore + build on first materialization can be slow.
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  outputDir: resolve(__dirname, `test-results/browser/${bundler}`),
  reporter: [
    ['list'],
    [
      'junit',
      {
        outputFile: resolve(__dirname, `test-results/browser/${bundler}/${configName}.junit.xml`),
      },
    ],
  ],
  use: {
    headless: true,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
