import { defineConfig } from '@playwright/test';

/**
 * The fixture-builder owns its own dev servers (each spec materializes and
 * starts a fixture), so there is no top-level `webServer` here. Specs manage
 * lifecycle via `buildFixture` / `Fixture.dispose`.
 */
export default defineConfig({
  testDir: 'tests',
  testMatch: ['*.change.test.ts', '*.spec.ts'],
  // .NET restore + build on first materialization can be slow.
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['junit', { outputFile: 'test-results/fixture-builder.junit.xml' }]],
  use: {
    headless: true,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
