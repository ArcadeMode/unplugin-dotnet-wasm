import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { buildFixture, type Fixture } from '@dotnet-wasm-bundler/fixture-builder';
import { permuteFixture } from '../../helpers/permute-fixture-node';

//  Special case: tests that running with vitest works 
//  (there is no node server, vitest however does something similar)
permuteFixture({ bundler: 'vite', platform: 'node', serveMode: 'server' }, (params) => {
  describe('vite node server (Vitest SSR)', () => {
    let fixture: Fixture;

    beforeAll(async () => {
      fixture = await buildFixture({ ...params, buildMode: 'debug' });
      await fixture.buildLibrary();
    });

    afterAll(async () => {
      await fixture?.dispose();
    });

    test('boots .NET WASM under the Vitest SSR pipeline and runs interop', async () => {
      const result = await fixture.runScript('dev');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('NUGET_STATICWEBASSET:ok');
      expect(result.stdout).toContain('INCREMENT:3');
      expect(result.stdout).toContain('INCREMENT:6');
    });

    test('altered library rebuild is visible on the next SSR run', async () => {
      await fixture.buildLibrary({ altered: true });
      const result = await fixture.runScript('dev');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('NUGET_STATICWEBASSET:ok');
      expect(result.stdout).toContain('INCREMENT:5');
      expect(result.stdout).toContain('INCREMENT:10');
    });
  });
});
