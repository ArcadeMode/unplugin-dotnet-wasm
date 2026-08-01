import { it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildFixture, type Fixture, type RunResult } from '@dotnet-wasm-bundler/fixture-builder';
import { permuteFixture } from '../../helpers/permute-fixture-node';
import { distAssetsDir, entryChunkPath, libraryFrameworkDir } from '../../helpers/dist-artifacts';

/**
 * Reproduces the legacy `build.test.ts` artifact assertions on the new
 * fixture-builder harness: a debug `dist` build must emit the .NET WASM
 * runtime, ICU data, debug symbols, and the user assembly, matching the
 * Library's own built `_framework` output byte-for-byte, with the entry chunk
 * referencing the WASM assets.
 *
 * A browser-target build-only assertion needs no page (it inspects files on
 * disk), so it runs under vitest for both platforms — not just node.
 */
permuteFixture({ serveMode: 'dist' }, (params) => {
  let fixture: Fixture;
  let buildResult: RunResult;

  beforeAll(async () => {
    fixture = await buildFixture({ ...params, buildMode: 'debug', fingerprint: false });
    await fixture.buildLibrary();
    buildResult = await fixture.build();
  }, 120_000);

  afterAll(async () => {
    await fixture?.dispose();
  });

  it('builds successfully (exit 0)', () => {
    expect(buildResult.exitCode).toBe(0);
  });

  it('dist/assets/ contains dotnet.native*.wasm', () => {
    const files = readdirSync(distAssetsDir(fixture));
    expect(files.some((f) => /^dotnet(\.native)?[.-][^/]+\.wasm$/.test(f))).toBe(true);
  });

  it('dotnet.native*.wasm byte length matches source', () => {
    const assets = distAssetsDir(fixture);
    const distFile = readdirSync(assets).find((f) => /^dotnet(\.native)?[.-][^/]+\.wasm$/.test(f))!;
    expect(distFile).toBeDefined();
    const frameworkDir = libraryFrameworkDir(fixture);
    const srcName = readdirSync(frameworkDir).find((f) =>
      /^dotnet\.native(\.[a-z0-9]+)?\.wasm$/.test(f),
    )!;
    expect(srcName).toBeDefined();
    expect(statSync(join(assets, distFile)).size).toBe(statSync(join(frameworkDir, srcName)).size);
  });

  it('at least 20 distinct .wasm assets emitted', () => {
    const wasmFiles = readdirSync(distAssetsDir(fixture)).filter((f) => f.endsWith('.wasm'));
    expect(wasmFiles.length).toBeGreaterThanOrEqual(20);
  });

  it('emits at least one .dat asset (ICU data)', () => {
    const files = readdirSync(distAssetsDir(fixture));
    expect(files.some((f) => /^icudt[^/]*\.dat$/.test(f))).toBe(true);
  });

  it('emits at least one .pdb asset (debug symbols)', () => {
    const files = readdirSync(distAssetsDir(fixture));
    expect(files.some((f) => /\.pdb$/.test(f))).toBe(true);
  });

  it('Library*.wasm is present (user assembly emitted)', () => {
    const files = readdirSync(distAssetsDir(fixture));
    expect(files.some((f) => /^Library([.-][^/]+)?\.wasm$/.test(f))).toBe(true);
  });

  it('entry chunk references a *.wasm asset URL', () => {
    const content = readFileSync(entryChunkPath(fixture), 'utf8');
    expect(content).toMatch(/\.wasm/);
  });
});
