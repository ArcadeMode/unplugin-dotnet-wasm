import { test, expect, beforeAll, afterAll, describe } from 'vitest';
import { buildFixture, type Fixture } from '@dotnet-wasm-bundler/fixture-builder';
import { permuteFixture } from '../../helpers/permute-fixture-node';

/** Assert that the publish dist actually runs. */
describe('[publish]', () => {
  permuteFixture({ platform: 'node', serveMode: 'watch' }, (params) => {
    let fixture: Fixture;

    beforeAll(async () => {
      fixture = await buildFixture({ ...params, buildMode: 'publish' });
      await fixture.buildLibrary();
      await fixture.start();
    }, 180_000);

    afterAll(async () => {
      await fixture?.dispose();
    });

    test('interop reflects the altered rebuild after watch re-emit + node restart', async () => {
      const first = await fixture.runNode();
      expect(first.output).toContain('NUGET_STATICWEBASSET:ok');
      expect(first.output).toContain('INCREMENT:3');
      expect(first.output).toContain('INCREMENT:6');

      const baseline = fixture.snapshotDist();
      await fixture.buildLibrary({ altered: true });
      await fixture.waitForDistChange(baseline);

      const second = await fixture.runNode({ timeout: 60_000 });
      expect(second.output).toContain('NUGET_STATICWEBASSET:ok');
      expect(second.output).toContain('INCREMENT:5');
      expect(second.output).toContain('INCREMENT:10');
    }, 180_000);
  });
});
