import { test } from '@playwright/test';
import { buildFixture, type Fixture } from '@dotnet-wasm-bundler/fixture-builder';
import { permuteFixture } from '../../helpers/permute-fixture';
import { trackConsoleMessages, expectMessages, waitForInit } from '../../helpers/assertions';

/**
 * Browser dist change test: builds the bundle against a baseline library, serves
 * `dist/` statically, asserts the baseline interop, rebuilds the library from
 * the altered branch, rebuilds the bundle, reloads the page, and asserts the
 * altered interop. Baseline increments by 3 (→ INCREMENT:3, INCREMENT:6);
 * altered increments by 5 (→ INCREMENT:5, INCREMENT:10).
 *
 * Runs for every implemented bundler whose `dist` output boots in a browser;
 * unsupported bundlers appear as visible skips.
 *
 * Dual-fingerprint smoke: this is the only change test that also runs with
 * `fingerprint: false` (SDK default is true everywhere else).
 */
for (const fingerprint of [true, false] as const) {
  test.describe(`[fingerprint=${fingerprint}]`, () => {
    permuteFixture({ platform: 'browser', serveMode: 'dist' }, (params) => {
      let fixture: Fixture;

      test.beforeAll(async () => {
        fixture = await buildFixture({ ...params, buildMode: 'debug', fingerprint });
        await fixture.buildLibrary();
        await fixture.build();
        await fixture.serve();
      });

      test.afterAll(async () => {
        await fixture?.dispose();
      });

      test('interop reflects the altered rebuild after a manual reload', async ({ page }) => {
        const consoleMsgs = trackConsoleMessages(page);
        await page.goto(fixture.baseUrl);

        const bootTs = await waitForInit(page);
        await expectMessages(consoleMsgs, ['NUGET_STATICWEBASSET:ok', 'INCREMENT:3', 'INCREMENT:6']);

        await fixture.buildLibrary({ altered: true });
        await fixture.build();
        await page.reload();

        await waitForInit(page, bootTs);
        await expectMessages(consoleMsgs, ['NUGET_STATICWEBASSET:ok', 'INCREMENT:5', 'INCREMENT:10']);
      });
    });
  });
}
