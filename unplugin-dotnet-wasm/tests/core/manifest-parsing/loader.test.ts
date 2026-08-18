import { mkdtempSync } from 'node:fs';
import { writeFile, stat, utimes, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { ManifestLoader } from '@src/core/manifest-parsing/loader';
import { DiscoveryError } from '@src/core/manifest-parsing/discover';
import type { DotnetWasmOptions } from '@src/types';

const PROJECT = 'Lib';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'manifest-loader-'));
}

function optionsFor(dir: string): DotnetWasmOptions {
  return { projectName: PROJECT, dotnetOutputDir: dir };
}

function endpointsPath(dir: string): string {
  return join(dir, `${PROJECT}.staticwebassets.endpoints.json`);
}

function runtimePath(dir: string): string {
  return join(dir, `${PROJECT}.staticwebassets.runtime.json`);
}

function endpointsJson(routeCount: number): string {
  return JSON.stringify({
    Version: 1,
    ManifestType: 'Build',
    Endpoints: Array.from({ length: routeCount }, (_, i) => ({
      Route: `_framework/f${i}.js`,
      AssetFile: `_framework/f${i}.js`,
      Selectors: [],
      ResponseHeaders: [],
      EndpointProperties: [],
    })),
  });
}

function runtimeJson(contentRoot: string): string {
  return JSON.stringify({
    ContentRoots: [contentRoot],
    Root: { Children: null, Asset: null, Patterns: null },
  });
}

async function writeEndpoints(dir: string, routeCount = 0): Promise<void> {
  await writeFile(endpointsPath(dir), endpointsJson(routeCount));
}

async function writeRuntime(dir: string, contentRoot = 'C:/a/'): Promise<void> {
  await writeFile(runtimePath(dir), runtimeJson(contentRoot));
}

describe('ManifestLoader', () => {
  it('returns fromCache: false on the first load', async () => {
    const dir = makeDir();
    await writeEndpoints(dir);
    await writeRuntime(dir);
    const result = await new ManifestLoader().load(optionsFor(dir));
    expect(result.fromCache).toBe(false);
    expect(result.endpointsManifest.Version).toBe(1);
    expect(result.runtimeManifest).not.toBeNull();
    expect(result.endpointsManifestPath).toBe(endpointsPath(dir));
  });

  it('returns fromCache: true and the same parsed objects when files are unchanged', async () => {
    const dir = makeDir();
    await writeEndpoints(dir, 1);
    await writeRuntime(dir);
    const loader = new ManifestLoader();
    const first = await loader.load(optionsFor(dir));
    const second = await loader.load(optionsFor(dir));
    expect(second.fromCache).toBe(true);
    expect(second.endpointsManifest).toBe(first.endpointsManifest);
    expect(second.runtimeManifest).toBe(first.runtimeManifest);
  });

  it('misses after an overwrite and re-caches on the next stable load', async () => {
    const dir = makeDir();
    await writeEndpoints(dir, 1);
    await writeRuntime(dir);
    const loader = new ManifestLoader();

    const first = await loader.load(optionsFor(dir));
    expect(first.fromCache).toBe(false);

    await writeEndpoints(dir, 2);
    const second = await loader.load(optionsFor(dir));
    expect(second.fromCache).toBe(false);
    expect(second.endpointsManifest).not.toBe(first.endpointsManifest);
    expect(second.endpointsManifest.Endpoints).toHaveLength(2);
    expect(second.runtimeManifest).toBe(first.runtimeManifest);

    const third = await loader.load(optionsFor(dir));
    expect(third.fromCache).toBe(true);
    expect(third.endpointsManifest).toBe(second.endpointsManifest);
    expect(third.runtimeManifest).toBe(second.runtimeManifest);
  });

  it('misses when only the file size changes', async () => {
    const dir = makeDir();
    await writeEndpoints(dir, 1);
    await writeRuntime(dir);
    const loader = new ManifestLoader();
    const first = await loader.load(optionsFor(dir));
    const previous = await stat(endpointsPath(dir));
    await writeEndpoints(dir, 3);
    await utimes(endpointsPath(dir), previous.atime, previous.mtime);
    const second = await loader.load(optionsFor(dir));
    expect(second.fromCache).toBe(false);
    expect(second.endpointsManifest).not.toBe(first.endpointsManifest);
    expect(second.endpointsManifest.Endpoints).toHaveLength(3);
  });

  it('misses when the runtime file appears or disappears', async () => {
    const dir = makeDir();
    await writeEndpoints(dir);
    await writeRuntime(dir, 'C:/a/');
    const loader = new ManifestLoader();

    const withRuntime = await loader.load(optionsFor(dir));
    expect(withRuntime.fromCache).toBe(false);
    expect(withRuntime.runtimeManifest?.ContentRoots).toEqual(['C:/a/']);

    await unlink(runtimePath(dir));
    const withoutRuntime = await loader.load(optionsFor(dir));
    expect(withoutRuntime.fromCache).toBe(false);
    expect(withoutRuntime.runtimeManifest).toBeNull();

    const stillAbsent = await loader.load(optionsFor(dir));
    expect(stillAbsent.fromCache).toBe(true);
    expect(stillAbsent.runtimeManifest).toBeNull();

    await writeRuntime(dir, 'C:/b/');
    const reappeared = await loader.load(optionsFor(dir));
    expect(reappeared.fromCache).toBe(false);
    expect(reappeared.runtimeManifest?.ContentRoots).toEqual(['C:/b/']);
  });

  it('throws when the endpoints manifest is missing', async () => {
    const dir = makeDir();
    await expect(new ManifestLoader().load(optionsFor(dir))).rejects.toThrow(DiscoveryError);
  });
});
