import { test } from '@playwright/test';
import { buildFixture, type Fixture } from '@dotnet-wasm-bundler/fixture-builder';
import { permuteFixture } from '../../helpers/permute-fixture';
import { trackConsoleMessages, expectMessages, waitForInit } from '../../helpers/assertions';

permuteFixture({ platform: 'browser', serveMode: 'watch' }, (params) => {
  let fixture: Fixture;

  test.beforeAll(
    async () => {
      fixture = await buildFixture({ ...params, buildMode: 'debug' });
      await fixture.buildLibrary();
      await fixture.start();
    },
    { timeout: 180_000 },
  );

  test.afterAll(async () => {
    await fixture?.dispose();
  });

  test('interop reflects the altered rebuild after watch re-emit + reload', async ({ page }) => {
    const consoleMsgs = trackConsoleMessages(page);
    await page.goto(fixture.baseUrl);

    const bootTs = await waitForInit(page);
    await expectMessages(consoleMsgs, ['NUGET_STATICWEBASSET:ok', 'INCREMENT:3', 'INCREMENT:6']);

    const baseline = fixture.snapshotDist();
    await fixture.buildLibrary({ altered: true });
    await fixture.waitForDistChange(baseline);
    await page.reload();

    await waitForInit(page, bootTs);
    await expectMessages(consoleMsgs, ['NUGET_STATICWEBASSET:ok', 'INCREMENT:5', 'INCREMENT:10']);
  });
});
