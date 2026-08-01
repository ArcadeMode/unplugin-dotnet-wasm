import { defineConfig } from '@playwright/test';

/**
 * Browser E2E suite. Specs drive the `@dotnet-wasm-bundler/fixture-builder`
 * harness, which materializes a project + isolated .NET Library, owns its own
 * dev server, and cleans up on `Fixture.dispose` — so there is no top-level
 * `webServer` here.
 */
export default defineConfig({
  testDir: 'tests',
  testMatch: ['*.change.test.ts', '*.spec.ts'],
  // .NET restore + build on first materialization can be slow.
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['junit', { outputFile: 'test-results/e2e.junit.xml' }]],
  use: {
    headless: true,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
