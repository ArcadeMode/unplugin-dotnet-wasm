import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildFixture, supports, type Fixture } from '@dotnet-wasm-bundler/fixture-builder';
import { envFilter } from '../../helpers/envFilter';
import { expectFingerprintLayout, libraryFrameworkDir } from '../../helpers/dist-artifacts';

/**
 * Fingerprint naming contract on the Library `_framework` output (source of
 * truth for `-p:WasmFingerprintAssets`). Runs vite × both platforms × both
 * fingerprint values — cheap relative to dual-smoke-ing every bundler.
 *
 * `fingerprint: true` is also asserted in `build.test.ts` across the full
 * bundler grid (default). This file is the dedicated `false` coverage plus an
 * explicit true/false pair on one bundler.
 */
const filter = envFilter();

for (const fingerprint of [true, false] as const) {
  for (const platform of ['browser', 'node'] as const) {
    const params = {
      bundler: 'vite' as const,
      platform,
      serveMode: 'dist' as const,
    };
    const skipFilter =
      (filter.bundler !== undefined && filter.bundler !== params.bundler) ||
      (filter.platform !== undefined && filter.platform !== params.platform);
    const skipUnsupported = !supports(params.bundler, params.platform, params.serveMode);

    describe.skipIf(skipFilter || skipUnsupported)(
      `[${params.bundler}][${params.platform}][${params.serveMode}][fingerprint=${fingerprint}] layout`,
      () => {
        let fixture: Fixture;

        beforeAll(async () => {
          fixture = await buildFixture({ ...params, buildMode: 'debug', fingerprint });
          await fixture.buildLibrary();
        }, 120_000);

        afterAll(async () => {
          await fixture?.dispose();
        });

        it('Library _framework naming matches WasmFingerprintAssets', () => {
          expect(fixture.fingerprint).toBe(fingerprint);
          expectFingerprintLayout(libraryFrameworkDir(fixture), fingerprint);
        });
      },
    );
  }
}
