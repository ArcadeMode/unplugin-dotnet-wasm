import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { buildFixture, supports, type Fixture } from '@dotnet-wasm-bundler/fixture-builder';
import { envFilter } from '../../helpers/envFilter';

const filter = envFilter();
const params = {
  bundler: 'vite' as const,
  platform: 'node' as const,
  serveMode: 'dist' as const,
};
const skip =
  (filter.bundler !== undefined && filter.bundler !== params.bundler) ||
  (filter.platform !== undefined && filter.platform !== params.platform) ||
  !supports(params.bundler, params.platform, params.serveMode);

describe.skipIf(skip)(
  `[${params.bundler}][${params.platform}][${params.serveMode}][publish] runtime`,
  () => {
    let fixture: Fixture;

    beforeAll(async () => {
      fixture = await buildFixture({ ...params, buildMode: 'publish' });
      await fixture.buildLibrary();
      const result = await fixture.build();
      expect(result.exitCode).toBe(0);
    }, 180_000);

    afterAll(async () => {
      await fixture?.dispose();
    });

    test('boots publish output and runs TypeShim + Counter interop', async () => {
      const result = await fixture.run();
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('NUGET_STATICWEBASSET:ok');
      expect(result.stdout).toContain('INCREMENT:3');
      expect(result.stdout).toContain('INCREMENT:6');
    }, 60_000);
  },
);
