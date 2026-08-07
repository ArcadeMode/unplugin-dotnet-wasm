import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildFixture, type Fixture } from '@dotnet-wasm-bundler/fixture-builder';
import { permuteFixture } from '../../helpers/permute-fixture-node';
import { libraryFrameworkDir } from '../../helpers/dist-artifacts';
import { expectFingerprintLayout } from '../../helpers/assertions';

for (const fingerprint of [true, false] as const) {
  permuteFixture({ bundler: 'vite', serveMode: 'dist' }, (params) => {
    describe(`[fingerprint=${fingerprint}] layout`, () => {
      let fixture: Fixture;

      beforeAll(async () => {
        fixture = await buildFixture({ ...params, buildMode: 'debug', clean: true });
        await fixture.buildLibrary({ fingerprint });
      });

      afterAll(async () => {
        await fixture?.dispose();
      });

      it('Library _framework naming matches WasmFingerprintAssets', () => {
        expectFingerprintLayout(libraryFrameworkDir(fixture), fingerprint);
      });
    });
  });
}
