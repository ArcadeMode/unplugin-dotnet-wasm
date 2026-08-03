import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const bundler = process.env.FIXTURE_BUNDLER ?? 'all';
const configName = `e2e-playwright-${bundler}-browser-${process.platform}`;

/**
 * Browser E2E suite. Specs drive the `@dotnet-wasm-bundler/fixture-builder`
 * harness, which materializes a project + isolated .NET Library, owns its own
 * dev server, and cleans up on `Fixture.dispose` — so there is no top-level
 * `webServer` here.
 */
export default defineConfig({
  testDir: 'tests/playwright',
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
