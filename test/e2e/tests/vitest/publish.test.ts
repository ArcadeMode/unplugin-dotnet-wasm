import { it, expect, beforeAll, afterAll, describe } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildFixture, type Fixture } from '@dotnet-wasm-bundler/fixture-builder';
import { permuteFixture } from '../../helpers/permute-fixture-node';
import {
  distAssetsDir,
  entryChunkPath,
  libraryFrameworkDir,
  libraryPublishDir,
} from '../../helpers/dist-artifacts';

/**
 * Reproduces the legacy `publish.test.ts` artifact assertions (`dotnet publish
 * -c Release` output) plus the `DiscoveryError` case when the publish output is
 * absent — replacing the retired `none` build-mode matrix cell.
 */
permuteFixture({ serveMode: 'dist' }, (params) => {
  describe('publish build (isPublish: true)', () => {
    let fixture: Fixture;

    beforeAll(async () => {
      fixture = await buildFixture({ ...params, buildMode: 'publish', fingerprint: false });
      await fixture.buildLibrary();
      const result = await fixture.build();
      expect(result.exitCode).toBe(0);
    }, 120_000);

    afterAll(async () => {
      await fixture?.dispose();
    });

    it('emits at least one .wasm file in dist/assets/', () => {
      const wasmFiles = readdirSync(distAssetsDir(fixture)).filter((f) => f.endsWith('.wasm'));
      expect(wasmFiles.length).toBeGreaterThan(0);
    });

    it('Library*.wasm is emitted including hash', () => {
      const files = readdirSync(distAssetsDir(fixture));
      expect(files.some((f) => /^Library([.-][^/]+)?\.wasm$/.test(f))).toBe(true);
    });

    it('dotnet.native*.wasm byte length matches publish source', () => {
      const assets = distAssetsDir(fixture);
      const distFile = readdirSync(assets).find((f) =>
        /^dotnet(\.native)?[.-][^/]+\.wasm$/.test(f),
      );
      expect(distFile).toBeDefined();
      const frameworkDir = libraryFrameworkDir(fixture);
      const srcName = readdirSync(frameworkDir).find((f) =>
        /^dotnet\.native(\.[a-z0-9]+)?\.wasm$/.test(f),
      )!;
      expect(srcName).toBeDefined();
      expect(statSync(join(assets, distFile!)).size).toBe(
        statSync(join(frameworkDir, srcName)).size,
      );
    });

    it('entry chunk references a *.wasm asset URL', () => {
      const content = readFileSync(entryChunkPath(fixture), 'utf8');
      expect(content).toMatch(/\.wasm/);
    });
  });

  describe('DiscoveryError when publish output is absent', () => {
    it('isPublish: true -> fails naming the searched publish dir', async () => {
      const fixture = await buildFixture({
        ...params,
        buildMode: 'publish',
        fingerprint: false,
      });
      try {
        const expectedDir = libraryPublishDir(fixture);
        // Deliberately skip fixture.buildLibrary(): the publish output must
        // be absent for the plugin to raise DiscoveryError. Capture the
        // rejection once and assert on it multiple times.
        const err = await fixture.build().then(
          () => {
            throw new Error('expected fixture.build() to reject with a DiscoveryError');
          },
          (e: unknown) => e as Error,
        );
        expect(err.message).toMatch(/Endpoints manifest not found at .*publish/);
        expect(err.message).toContain(expectedDir);
      } finally {
        await fixture.dispose();
      }
    }, 60_000);
  });
});
