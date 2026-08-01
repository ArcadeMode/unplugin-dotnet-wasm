import { test, expect } from '@playwright/test';
import { buildFixture, type Fixture } from '@dotnet-wasm-bundler/fixture-builder';
import { permuteFixture } from '../helpers/permute-fixture';

/**
 * Browser dist change test: builds the bundle against a baseline library, serves
 * `dist/` statically, asserts the baseline greeting, rebuilds the library from
 * the altered branch, rebuilds the bundle, reloads the page, and asserts the
 * altered greeting.
 *
 * Runs for every implemented bundler whose `dist` output boots in a browser;
 * unsupported bundlers appear as visible skips.
 */
permuteFixture({ platform: 'browser', serveMode: 'dist' }, (params) => {
  let fixture: Fixture;

  test.beforeAll(async () => {
    fixture = await buildFixture({ ...params, buildMode: 'debug', fingerprint: false });
    await fixture.build();
    await fixture.serve();
  });

  test.afterAll(async () => {
    await fixture?.dispose();
  });

  test('greeting flips Hello → Hola after an altered rebuild + reload', async ({ page }) => {
    await page.goto(fixture.baseUrl);
    await page.waitForFunction(() => (globalThis as any).__libReady === true, null, {
      timeout: 15_000,
    });

    const baseline = await page.evaluate(() => (globalThis as any).__lib.greet('world'));
    expect(baseline).toBe('Hello, world');

    // The change trigger: rebuild the library from the altered branch, rebuild
    // the bundle, then reload to load the new wasm.
    await fixture.buildLibrary({ altered: true });
    await fixture.build();
    await page.reload();

    await page.waitForFunction(
      () =>
        (globalThis as any).__libReady === true &&
        (globalThis as any).__lib.greet('world') === 'Hola, world',
      null,
      { timeout: 15_000 },
    );

    const altered = await page.evaluate(() => (globalThis as any).__lib.greet('world'));
    expect(altered).toBe('Hola, world');
  });
});
