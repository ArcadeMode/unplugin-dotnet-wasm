import { test } from '@playwright/test';
import { buildFixture, supports, type Fixture } from '@dotnet-wasm-bundler/fixture-builder';
import { envFilter } from '../../helpers/envFilter';
import { trackConsoleMessages, expectMessages, waitForInit } from '../../helpers/assertions';

const filter = envFilter();
const params = {
  bundler: 'vite' as const,
  platform: 'browser' as const,
  serveMode: 'server' as const,
};
const skip =
  (filter.bundler !== undefined && filter.bundler !== params.bundler) ||
  (filter.platform !== undefined && filter.platform !== params.platform) ||
  !supports(params.bundler, params.platform, params.serveMode);

(skip ? test.describe.skip : test.describe)(
  `[${params.bundler}][${params.platform}][${params.serveMode}][publish]`,
  () => {
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
  },
);
