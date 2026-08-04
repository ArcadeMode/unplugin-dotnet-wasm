import { test } from '@playwright/test';
import { buildFixture, type Fixture } from '@dotnet-wasm-bundler/fixture-builder';
import { permuteFixture } from '../../helpers/permute-fixture';
import { trackConsoleMessages, expectMessages, waitForInit } from '../../helpers/assertions';

permuteFixture({ platform: 'browser', serveMode: 'server' }, (params) => {
  test.describe('publish', () => {
    let fixture: Fixture;

    test.beforeAll(async () => {
      fixture = await buildFixture({ ...params, buildMode: 'publish' });
      await fixture.buildLibrary();
      await fixture.start();
    });

    test.afterAll(async () => {
      await fixture?.dispose();
    });

    test('dev server boots publish output and reflects an altered rebuild', async ({ page }) => {
      const consoleMsgs = trackConsoleMessages(page);
      await page.goto(fixture.baseUrl);
      const bootTs = await waitForInit(page);
      await expectMessages(consoleMsgs, ['NUGET_STATICWEBASSET:ok', 'INCREMENT:3', 'INCREMENT:6']);

      await fixture.buildLibrary({ altered: true });
      await waitForInit(page, bootTs);
      await expectMessages(consoleMsgs, ['NUGET_STATICWEBASSET:ok', 'INCREMENT:5', 'INCREMENT:10']);
    });
  });
});
