import { test, expect, beforeAll, afterAll } from 'vitest';
import { buildFixture, type Fixture } from '@dotnet-wasm-bundler/fixture-builder';
import { permuteFixture } from '../../helpers/permute-fixture-node';

/**
 * Node watch change test: bundler `--watch` emits to `dist/`, then
 * `node --watch dist/entry.js` runs the artifact. Mid-test library rebuild →
 * wait for dist stabilize → wait for process restart output → assert altered
 * interop.
 *
 * Baseline increments by 3 (→ INCREMENT:3, INCREMENT:6); altered by 5
 * (→ INCREMENT:5, INCREMENT:10). Uses fingerprint: true (SDK default).
 */
permuteFixture({ platform: 'node', serveMode: 'watch' }, (params) => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await buildFixture({ ...params, buildMode: 'debug' });
    await fixture.buildLibrary();
    await fixture.start();
  }, 180_000);

  afterAll(async () => {
    await fixture?.dispose();
  });

  test('interop reflects the altered rebuild after watch re-emit + node restart', async () => {
    expect(fixture.nodeLogs).toContain('NUGET_STATICWEBASSET:ok');
    expect(fixture.nodeLogs).toContain('INCREMENT:3');
    expect(fixture.nodeLogs).toContain('INCREMENT:6');

    const baseline = fixture.snapshotDist();
    const logMark = fixture.nodeLogs.length;
    await fixture.buildLibrary({ altered: true });
    await fixture.waitForDistChange(baseline);
    await fixture.waitForNodeLog(/INCREMENT:10/, { fromIndex: logMark, timeout: 60_000 });

    const after = fixture.nodeLogs.slice(logMark);
    expect(after).toContain('NUGET_STATICWEBASSET:ok');
    expect(after).toContain('INCREMENT:5');
    expect(after).toContain('INCREMENT:10');
  }, 180_000);
});
