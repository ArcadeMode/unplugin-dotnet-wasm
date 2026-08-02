import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildFixture, supports, type Fixture } from '@dotnet-wasm-bundler/fixture-builder';
import { envFilter } from '../../helpers/envFilter';
import { expectFingerprintLayout, libraryFrameworkDir } from '../../helpers/dist-artifacts';

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
          fixture = await buildFixture({ ...params, buildMode: 'debug' });
          await fixture.buildLibrary({ fingerprint });
        });

        afterAll(async () => {
          await fixture?.dispose();
        });

        it('Library _framework naming matches WasmFingerprintAssets', () => {
          expectFingerprintLayout(libraryFrameworkDir(fixture), fingerprint);
        });
      },
    );
  }
}
