import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect } from 'vitest';
import { discoverManifests } from '@src/core/manifest-parsing/discover';

const LIBRARY_ROOT = resolve(__dirname, '../../fixtures/Library');
const EXPECTED_MANIFEST = resolve(
  LIBRARY_ROOT,
  'bin/Debug/net10.0/Library.staticwebassets.runtime.json',
);
const PUBLISH_DIR = resolve(LIBRARY_ROOT, 'bin/Release/net10.0/publish');

describe('discoverManifests with real fixture', () => {
  it('finds both manifests with explicit TFM', () => {
    const result = discoverManifests({
      projectRoot: LIBRARY_ROOT,
      projectName: 'Library',
      configuration: 'Debug',
      targetFramework: 'net10.0',
    });
    expect(result.runtimeManifestPath).toBe(EXPECTED_MANIFEST);
    expect(result.endpointsManifestPath).toMatch(/Library\.staticwebassets\.endpoints\.json$/);
  });

  it('throws for an unbuilt configuration', () => {
    expect(() =>
      discoverManifests({
        projectRoot: LIBRARY_ROOT,
        projectName: 'Library',
        configuration: 'Bonkers',
        targetFramework: 'net10.0',
      }),
    ).toThrowError(/Endpoints manifest not found/);
  });

  it('throws for an unknown targetFramework', () => {
    expect(() =>
      discoverManifests({
        projectRoot: LIBRARY_ROOT,
        projectName: 'Library',
        configuration: 'Debug',
        targetFramework: 'net8.0',
      }),
    ).toThrowError(/Endpoints manifest not found/);
  });
});

describe('discoverManifests with real publish fixture', () => {
  it('finds the endpoints manifest under bin/Release/net10.0/publish/', () => {
    const result = discoverManifests({
      projectRoot: LIBRARY_ROOT,
      projectName: 'Library',
      configuration: 'Release',
      targetFramework: 'net10.0',
      isPublish: true,
    });
    expect(result.endpointsManifestPath).toBe(
      join(PUBLISH_DIR, 'Library.staticwebassets.endpoints.json'),
    );
  });

  it('returns runtimeManifestPath as null (publish does not emit runtime.json)', () => {
    const result = discoverManifests({
      projectRoot: LIBRARY_ROOT,
      projectName: 'Library',
      configuration: 'Release',
      targetFramework: 'net10.0',
      isPublish: true,
    });
    expect(result.runtimeManifestPath).toBeNull();
  });

  it('throws when the publish directory does not exist', () => {
    expect(() =>
      discoverManifests({
        projectRoot: LIBRARY_ROOT,
        projectName: 'Library',
        configuration: 'Staging',
        targetFramework: 'net10.0',
        isPublish: true,
      }),
    ).toThrowError(/Endpoints manifest not found/);
  });
});

describe('discoverManifests with explicit dotnetOutputDir option', () => {
  it('finds the endpoints sibling and returns null runtime path when file is absent', () => {
    const result = discoverManifests({
      projectName: 'Library',
      dotnetOutputDir: PUBLISH_DIR,
    });
    expect(result.runtimeManifestPath).toBeNull();
    expect(result.endpointsManifestPath).toBe(
      join(PUBLISH_DIR, 'Library.staticwebassets.endpoints.json'),
    );
  });

  it('throws when given a file path instead of a directory (regression: old manifestPath shape)', () => {
    expect(() =>
      discoverManifests({
        projectName: 'Library',
        dotnetOutputDir: join(PUBLISH_DIR, 'Library.staticwebassets.runtime.json'),
      }),
    ).toThrowError(/Endpoints manifest not found/);
  });
});

const NONEXISTENT_ROOT = join(tmpdir(), 'unplugin-dotnet-wasm-does-not-exist');

describe('discoverManifests with missing manifest', () => {
  it('throws when no manifest exists in the TFM dir', () => {
    expect(() =>
      discoverManifests({
        projectRoot: NONEXISTENT_ROOT,
        projectName: 'SomeProj',
        configuration: 'Debug',
        targetFramework: 'net10.0',
      }),
    ).toThrowError(/Endpoints manifest not found/);
  });

  it('throws when the configuration directory does not exist', () => {
    expect(() =>
      discoverManifests({
        projectRoot: NONEXISTENT_ROOT,
        projectName: 'Proj',
        configuration: 'Release',
        targetFramework: 'net10.0',
      }),
    ).toThrowError(/Endpoints manifest not found/);
  });
});
