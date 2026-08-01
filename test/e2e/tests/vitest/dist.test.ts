import { test, expect, beforeAll, afterAll } from 'vitest';
import { buildFixture, type Fixture } from '@dotnet-wasm-bundler/fixture-builder';
import { permuteFixture } from '../../helpers/permute-fixture-node';

/**
 * Node dist change test: builds the bundle against a baseline library, executes
 * `dist/entry.js` and asserts the baseline interop, rebuilds the library from
 * the altered branch, rebuilds the bundle, and asserts the altered interop.
 * Baseline increments by 3 (→ INCREMENT:3, INCREMENT:6); altered increments by
 * 5 (→ INCREMENT:5, INCREMENT:10).
 *
 * Runs for every implemented bundler that produces a runnable node artifact;
 * unsupported bundlers appear as visible skips.
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
    expect(baseline.stdout).toContain('INCREMENT:3');
    expect(baseline.stdout).toContain('INCREMENT:6');

    // The change trigger: rebuild the library from the altered branch, then
    // rebuild the bundle so it picks up the new wasm assets.
    await fixture.buildLibrary({ altered: true });
    await fixture.build();

    const altered = await fixture.run();
    expect(altered.stdout).toContain('INCREMENT:5');
    expect(altered.stdout).toContain('INCREMENT:10');
  });
});
