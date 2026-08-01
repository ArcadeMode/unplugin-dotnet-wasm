import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { buildFixture, supports, type Fixture } from '@dotnet-wasm-bundler/fixture-builder';
import { envFilter } from '../../helpers/envFilter';

/**
 * Phase 6 — isolated vite node `server` coverage.
 *
 * Vite's node "dev server" is Vitest driving the SSR / transform pipeline (not
 * an HTTP server). This path is fragile and lives in its own file so it can be
 * skipped without affecting the rest of the node suite:
 *
 *   SKIP_VITE_NODE_SERVER=1
 *
 * Also respects FIXTURE_BUNDLER / FIXTURE_PLATFORM shard filters.
 */
const filter = envFilter();
const params = {
  bundler: 'vite' as const,
  platform: 'node' as const,
  serveMode: 'server' as const,
};
const skipExplicit = process.env.SKIP_VITE_NODE_SERVER === '1';
const skipFilter =
  (filter.bundler !== undefined && filter.bundler !== params.bundler) ||
  (filter.platform !== undefined && filter.platform !== params.platform);
const skipUnsupported = !supports(params.bundler, params.platform, params.serveMode);

describe.skipIf(skipExplicit || skipFilter || skipUnsupported)(
  `[${params.bundler}][${params.platform}][${params.serveMode}] vite node server (Vitest SSR)`,
  () => {
    let fixture: Fixture;

    beforeAll(async () => {
      fixture = await buildFixture({ ...params, buildMode: 'debug' });
      await fixture.buildLibrary();
    }, 180_000);

    afterAll(async () => {
      await fixture?.dispose();
    });

    test('boots .NET WASM under the Vitest SSR pipeline and runs interop', async () => {
      const result = await fixture.runScript('dev');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('NUGET_STATICWEBASSET:ok');
      expect(result.stdout).toContain('INCREMENT:3');
      expect(result.stdout).toContain('INCREMENT:6');
    }, 120_000);

    test('altered library rebuild is visible on the next SSR run', async () => {
      await fixture.buildLibrary({ altered: true });
      const result = await fixture.runScript('dev');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('NUGET_STATICWEBASSET:ok');
      expect(result.stdout).toContain('INCREMENT:5');
      expect(result.stdout).toContain('INCREMENT:10');
    }, 180_000);
  },
);
