import { test } from '@playwright/test';
import { buildFixture, type Fixture } from '@dotnet-wasm-bundler/fixture-builder';
import { permuteFixture } from '../../helpers/permute-fixture';
import { trackConsoleMessages, expectMessages, waitForInit } from '../../helpers/assertions';

/**
 * Dev server change test: mid-test rebuilds the .NET library and asserts the
 * dev server's auto-pushed reload surfaces the altered interop. The baseline
 * library increments by 3 (→ INCREMENT:3, INCREMENT:6); the altered rebuild
 * increments by 5 (→ INCREMENT:5, INCREMENT:10).
 *
 * Runs for every implemented bundler with a browser dev server; unsupported
 * bundlers appear as visible skips.
 */
permuteFixture({ platform: 'browser', serveMode: 'server' }, (params) => {
  let fixture: Fixture;

  test.beforeAll(async () => {
    fixture = await buildFixture({ ...params, buildMode: 'debug', fingerprint: false });
    await fixture.buildLibrary();
    await fixture.start();
  });

  test.afterAll(async () => {
    await fixture?.dispose();
  });

  test('interop reflects the altered rebuild after the pushed reload', async ({ page }) => {
    const consoleMsgs = trackConsoleMessages(page);

    await page.goto(fixture.baseUrl);
    const bootTs = await waitForInit(page);
    await expectMessages(consoleMsgs, ['INCREMENT:3', 'INCREMENT:6']);

    await fixture.buildLibrary({ altered: true });
    await waitForInit(page, bootTs);
    await expectMessages(consoleMsgs, ['INCREMENT:5', 'INCREMENT:10']);
  });
});
