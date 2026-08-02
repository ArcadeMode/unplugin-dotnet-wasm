import { test } from '@playwright/test';
import { buildFixture, type Fixture } from '@dotnet-wasm-bundler/fixture-builder';
import { permuteFixture } from '../../helpers/permute-fixture';
import { trackConsoleMessages, expectMessages, waitForInit } from '../../helpers/assertions';

for (const fingerprint of [true, false] as const) {
  for (const buildMode of ['debug', 'publish'] as const) {
    test.describe(`[fingerprint=${fingerprint}][${buildMode}]`, () => {
      permuteFixture({ platform: 'browser', serveMode: 'dist' }, (params) => {
        let fixture: Fixture;

        test.beforeAll(async () => {
          fixture = await buildFixture({ ...params, buildMode, fingerprint });
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
          await expectMessages(consoleMsgs, [
            'NUGET_STATICWEBASSET:ok',
            'INCREMENT:3',
            'INCREMENT:6',
          ]);

          await fixture.buildLibrary({ altered: true });
          await fixture.build();
          await page.reload();

          await waitForInit(page, bootTs);
          await expectMessages(consoleMsgs, [
            'NUGET_STATICWEBASSET:ok',
            'INCREMENT:5',
            'INCREMENT:10',
          ]);
        });
      });
    });
  }
}
