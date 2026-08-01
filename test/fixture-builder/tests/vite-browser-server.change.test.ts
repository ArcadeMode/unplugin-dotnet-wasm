import { test, expect } from '@playwright/test';
import { buildFixture, type Fixture } from '../src/index';

/**
 * Phase 1 vertical slice: vite / browser / server.
 *
 * Boots a dev server against a freshly built (baseline) library, asserts the
 * baseline greeting, rebuilds the isolated library with `altered: true`, and
 * asserts the pushed reload surfaces the altered greeting — all without a
 * manual server restart.
 */
test.describe('[vite][browser][server] library change test', () => {
  let fixture: Fixture;

  test.beforeAll(async () => {
    fixture = await buildFixture({
      bundler: 'vite',
      platform: 'browser',
      serveMode: 'server',
      buildMode: 'debug',
      fingerprint: false,
    });
    await fixture.start();
  });

  test.afterAll(async () => {
    await fixture?.dispose();
  });

  test('greeting flips Hello → Hola after an altered rebuild + reload', async ({ page }) => {
    // Surface browser-side signals so a failed reload is diagnosable.
    let loadCount = 0;
    page.on('load', () => {
      loadCount += 1;
    });
    page.on('console', (msg) => {
      console.log(`[browser:${msg.type()}] ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      console.log(`[browser:pageerror] ${err.message}`);
    });

    await page.goto(fixture.baseUrl);
    await page.waitForFunction(() => (globalThis as any).__libReady === true, null, {
      timeout: 5_000,
    });

    const baseline = await page.evaluate(() => (globalThis as any).__lib.greet('world'));
    expect(baseline).toBe('Hello, world');

    // The change trigger: rebuild the isolated library from the altered branch.
    await fixture.buildLibrary({ altered: true });

    // The manifest watcher pushes a full reload; the re-booted page reports Hola.
    try {
      await page.waitForFunction(
        () =>
          (globalThis as any).__libReady === true &&
          (globalThis as any).__lib.greet('world') === 'Hola, world',
        null,
        { timeout: 15_000 },
      );
    } catch (err) {
      console.log(`[diag] loadCount=${loadCount}`);
      console.log(
        `[diag] --- server output ---\n${fixture.logs}\n[diag] --- end server output ---`,
      );
      throw err;
    }

    const altered = await page.evaluate(() => (globalThis as any).__lib.greet('world'));
    expect(altered).toBe('Hola, world');
  });
});
