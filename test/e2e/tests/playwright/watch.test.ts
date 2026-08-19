import { test } from '@playwright/test';
import { buildFixture, type Fixture } from '@unplugin-dotnet-wasm/fixture-builder';
import { permuteFixture } from '../../helpers/permute-fixture';
import {
  trackConsoleMessages,
  trackBlazorDoubleStart,
  expectMessages,
  waitForInit,
  reloadUntilBooted,
} from '../../helpers/assertions';

permuteFixture({ platform: 'browser', serveMode: 'watch', buildMode: 'debug' }, (params) => {
  let fixture: Fixture;

  test.beforeAll(async () => {
    fixture = await buildFixture(params);
    await fixture.buildLibrary();
    await fixture.start();
  });

  test.afterEach(({}, testInfo) => {
    if (testInfo.status !== 'passed') fixture?.enableDiagnostics();
  });

  test.afterAll(async () => {
    await fixture?.dispose();
  });

  test('interop reflects the altered rebuild after watch re-emit + reload', async ({ page }) => {
    const consoleMsgs = trackConsoleMessages(page);
    const assertNoBlazorDoubleStart = trackBlazorDoubleStart(page);
    await page.goto(fixture.baseUrl);

    const bootTs = await waitForInit(page);
    await expectMessages(consoleMsgs, ['NUGET_STATICWEBASSET:ok', 'INCREMENT:3', 'INCREMENT:6']);

    const baseline = fixture.rebuildToken();
    await fixture.buildLibrary({ altered: true });
    await fixture.waitForRebuild(baseline);
    await reloadUntilBooted(page, bootTs);

    await expectMessages(consoleMsgs, ['NUGET_STATICWEBASSET:ok', 'INCREMENT:5', 'INCREMENT:10']);
    assertNoBlazorDoubleStart();
  });
});
