import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { buildFixture, type Fixture } from '@unplugin-dotnet-wasm/fixture-builder';
import { permuteFixture } from '../../helpers/permute-fixture-node';
import { libraryFrameworkDir } from '../../helpers/dist-artifacts';
import { expectFingerprintLayout } from '../../helpers/assertions';

for (const fingerprint of [true, false] as const) {
  permuteFixture({ bundler: 'vite', serveMode: 'dist', buildMode: 'debug' }, (params) => {
    describe(`[fingerprint=${fingerprint}] layout`, () => {
      let fixture: Fixture;

      beforeAll(async () => {
        fixture = await buildFixture(params);
        await fixture.buildLibrary({ fingerprint });
      });

      afterEach((ctx) => {
        if (ctx.task.result?.state === 'fail') fixture?.enableDiagnostics();
      });

      afterAll(async () => {
        await fixture?.dispose();
      });

      it('Library _framework naming matches WasmFingerprintAssets', () => {
        expectFingerprintLayout(libraryFrameworkDir(fixture), fingerprint, fixture.projectName);
      });
    });
  });
}
