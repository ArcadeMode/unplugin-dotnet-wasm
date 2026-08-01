import { test, expect, beforeAll, afterAll } from 'vitest';
import { buildFixture, type Fixture } from '@dotnet-wasm-bundler/fixture-builder';
import { permuteFixture } from '../helpers/permute-fixture-node';

/**
 * Node dist change test: builds the bundle against a baseline library, executes
 * `dist/entry.js` and asserts the baseline greeting, rebuilds the library from
 * the altered branch, rebuilds the bundle, and asserts the altered greeting.
 *
 * Runs for every implemented bundler that produces a runnable node artifact;
 * unsupported bundlers appear as visible skips.
 */
permuteFixture({ platform: 'node', serveMode: 'dist' }, (params) => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await buildFixture({ ...params, buildMode: 'debug', fingerprint: false });
    await fixture.build();
  });

  afterAll(async () => {
    await fixture?.dispose();
  });

  test('greeting flips Hello → Hola after an altered rebuild', async () => {
    const baseline = await fixture.run();
    expect(baseline.stdout).toContain('GREETING:Hello, world');

    // The change trigger: rebuild the library from the altered branch, then
    // rebuild the bundle so it picks up the new wasm assets.
    await fixture.buildLibrary({ altered: true });
    await fixture.build();

    const altered = await fixture.run();
    expect(altered.stdout).toContain('GREETING:Hola, world');
  });
});
