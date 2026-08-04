import { test, expect, beforeAll, afterAll } from 'vitest';
import { buildFixture, type Fixture } from '@dotnet-wasm-bundler/fixture-builder';
import { permuteFixture } from '../../helpers/permute-fixture-node';

permuteFixture({ platform: 'node', serveMode: 'watch' }, (params) => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await buildFixture({ ...params, buildMode: 'debug' });
    await fixture.buildLibrary();
    await fixture.start();
  });

  afterAll(async () => {
    await fixture?.dispose();
  });

  test('interop reflects the altered rebuild after watch re-emit + node restart', async () => {
    const first = await fixture.runNode();
    expect(first.output).toContain('NUGET_STATICWEBASSET:ok');
    expect(first.output).toContain('INCREMENT:3');
    expect(first.output).toContain('INCREMENT:6');

    const baseline = fixture.rebuildToken();
    await fixture.buildLibrary({ altered: true });
    await fixture.waitForRebuild(baseline);

    const second = await fixture.runNode({ timeout: 60_000 });
    expect(second.output).toContain('NUGET_STATICWEBASSET:ok');
    expect(second.output).toContain('INCREMENT:5');
    expect(second.output).toContain('INCREMENT:10');
  });
});
