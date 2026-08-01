import { test } from '@playwright/test';
import { buildFixture, supports, type Fixture } from '@dotnet-wasm-bundler/fixture-builder';
import { envFilter } from '../../helpers/envFilter';
import { trackConsoleMessages, expectMessages, waitForInit } from '../../helpers/assertions';

/**
 * Publish-mode runtime smoke (vite browser dist): boots Release/`isPublish`
 * output and asserts TypeShim init + Counter interop. Artifact checks live in
 * vitest/publish.test.ts; this closes the "publish is artifacts-only" gap.
 */
const filter = envFilter();
const params = {
  bundler: 'vite' as const,
  platform: 'browser' as const,
  serveMode: 'dist' as const,
};
const skip =
  (filter.bundler !== undefined && filter.bundler !== params.bundler) ||
  (filter.platform !== undefined && filter.platform !== params.platform) ||
  !supports(params.bundler, params.platform, params.serveMode);

(skip ? test.describe.skip : test.describe)(
  `[${params.bundler}][${params.platform}][${params.serveMode}][publish] runtime`,
  () => {
    let fixture: Fixture;

    test.beforeAll(
      async () => {
        fixture = await buildFixture({ ...params, buildMode: 'publish' });
        await fixture.buildLibrary();
        await fixture.build();
        await fixture.serve();
      },
      { timeout: 180_000 },
    );

    test.afterAll(async () => {
      await fixture?.dispose();
    });

    test('boots publish output and runs TypeShim + Counter interop', async ({ page }) => {
      const consoleMsgs = trackConsoleMessages(page);
      await page.goto(fixture.baseUrl);
      await waitForInit(page);
      await expectMessages(consoleMsgs, ['NUGET_STATICWEBASSET:ok', 'INCREMENT:3', 'INCREMENT:6']);
    });
  },
);
