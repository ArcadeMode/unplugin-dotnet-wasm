import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { buildFixture, type Fixture } from '@dotnet-wasm-bundler/fixture-builder';
import { permuteFixture } from '../../helpers/permute-fixture-node';

for (const fingerprint of [true, false] as const) {
  for (const buildMode of ['debug', 'publish'] as const) {
    describe(`[fingerprint=${fingerprint}][${buildMode}]`, () => {
      permuteFixture({ platform: 'node', serveMode: 'dist' }, (params) => {
        let fixture: Fixture;

        beforeAll(async () => {
          fixture = await buildFixture({ ...params, buildMode, fingerprint });
          await fixture.buildLibrary();
          await fixture.build();
        }, 180_000);

        afterAll(async () => {
          await fixture?.dispose();
        });

        test('interop reflects the altered rebuild', async () => {
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
        }, 180_000);
      });
    });
  }
}
