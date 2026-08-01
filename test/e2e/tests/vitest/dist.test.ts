import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { buildFixture, supports, type Fixture } from '@dotnet-wasm-bundler/fixture-builder';
import { permuteFixture } from '../../helpers/permute-fixture-node';
import { envFilter } from '../../helpers/envFilter';

/**
 * Node dist change test: builds the bundle against a baseline library, executes
 * `dist/entry.js` and asserts the baseline interop, rebuilds the library from
 * the altered branch, rebuilds the bundle, and asserts the altered interop.
 * Baseline increments by 3 (→ INCREMENT:3, INCREMENT:6); altered increments by
 * 5 (→ INCREMENT:5, INCREMENT:10).
 *
 * Runs for every implemented bundler that produces a runnable node artifact;
 * unsupported bundlers appear as visible skips. Default fingerprint: true.
 */
permuteFixture({ platform: 'node', serveMode: 'dist' }, (params) => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await buildFixture({ ...params, buildMode: 'debug' });
    await fixture.buildLibrary();
    await fixture.build();
  });

  afterAll(async () => {
    await fixture?.dispose();
  });

  test('interop reflects the altered rebuild', async () => {
    const baseline = await fixture.run();
    expect(baseline.stdout).toContain('NUGET_STATICWEBASSET:ok');
    expect(baseline.stdout).toContain('INCREMENT:3');
    expect(baseline.stdout).toContain('INCREMENT:6');

    // The change trigger: rebuild the library from the altered branch, then
    // rebuild the bundle so it picks up the new wasm assets.
    await fixture.buildLibrary({ altered: true });
    await fixture.build();

    const altered = await fixture.run();
    expect(altered.stdout).toContain('NUGET_STATICWEBASSET:ok');
    expect(altered.stdout).toContain('INCREMENT:5');
    expect(altered.stdout).toContain('INCREMENT:10');
  });
});

/**
 * Node fingerprint:false smoke (vite only). Browser dual-fingerprint lives in
 * playwright/dist.test.ts across all bundlers.
 */
const filter = envFilter();
const fpFalseParams = {
  bundler: 'vite' as const,
  platform: 'node' as const,
  serveMode: 'dist' as const,
};
const skipFpFalse =
  (filter.bundler !== undefined && filter.bundler !== fpFalseParams.bundler) ||
  (filter.platform !== undefined && filter.platform !== fpFalseParams.platform) ||
  !supports(fpFalseParams.bundler, fpFalseParams.platform, fpFalseParams.serveMode);

describe.skipIf(skipFpFalse)(
  `[${fpFalseParams.bundler}][${fpFalseParams.platform}][${fpFalseParams.serveMode}][fingerprint=false]`,
  () => {
    let fixture: Fixture;

    beforeAll(async () => {
      fixture = await buildFixture({
        ...fpFalseParams,
        buildMode: 'debug',
        fingerprint: false,
      });
      await fixture.buildLibrary();
      await fixture.build();
    }, 120_000);

    afterAll(async () => {
      await fixture?.dispose();
    });

    test('interop reflects the altered rebuild without asset fingerprinting', async () => {
      const baseline = await fixture.run();
      expect(baseline.stdout).toContain('NUGET_STATICWEBASSET:ok');
      expect(baseline.stdout).toContain('INCREMENT:3');
      expect(baseline.stdout).toContain('INCREMENT:6');

      await fixture.buildLibrary({ altered: true });
      await fixture.build();

      const altered = await fixture.run();
      expect(altered.stdout).toContain('NUGET_STATICWEBASSET:ok');
      expect(altered.stdout).toContain('INCREMENT:5');
      expect(altered.stdout).toContain('INCREMENT:10');
    }, 120_000);
  },
);
