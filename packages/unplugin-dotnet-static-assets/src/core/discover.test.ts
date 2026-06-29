import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { discoverManifests } from './discover.js';

// ---------------------------------------------------------------------------
// Real fixture
// ---------------------------------------------------------------------------

const LIBRARY_ROOT = resolve(__dirname, '../../../../test/fixtures/Library');
const EXPECTED_MANIFEST = resolve(
  LIBRARY_ROOT,
  'bin/Debug/net10.0/Library.staticwebassets.runtime.json',
);
const PUBLISH_DIR = resolve(LIBRARY_ROOT, 'bin/Release/net10.0/publish');

describe('discoverManifests — real fixture', () => {
  it('finds both manifests with explicit TFM', () => {
    const result = discoverManifests({ projectRoot: LIBRARY_ROOT, projectName: 'Library', targetFramework: 'net10.0' });
    expect(result.runtimeManifestPath).toBe(EXPECTED_MANIFEST);
    expect(result.endpointsManifestPath).toMatch(/Library\.staticwebassets\.endpoints\.json$/);
  });

  it('finds the manifest with all axes explicit', () => {
    const result = discoverManifests({
      projectRoot: LIBRARY_ROOT,
      projectName: 'Library',
      configuration: 'Debug',
      targetFramework: 'net10.0',
    });
    expect(result.runtimeManifestPath).toBe(EXPECTED_MANIFEST);
  });

  it('throws for an unbuilt configuration', () => {
    expect(() => discoverManifests({ projectRoot: LIBRARY_ROOT, projectName: 'Library', configuration: 'Release' })).toThrowError(/Endpoints manifest not found/);
  });

  it('throws for an unknown targetFramework', () => {
    expect(() => discoverManifests({ projectRoot: LIBRARY_ROOT, projectName: 'Library', targetFramework: 'net8.0' })).toThrowError(/Endpoints manifest not found/);
  });
});

describe('discoverManifests — isPublish (real Release publish fixture)', () => {
  it('finds the endpoints manifest under bin/Release/net10.0/publish/', () => {
    const result = discoverManifests({
      projectRoot: LIBRARY_ROOT,
      projectName: 'Library',
      configuration: 'Release',
      targetFramework: 'net10.0',
      isPublish: true,
    });
    expect(result.endpointsManifestPath).toBe(join(PUBLISH_DIR, 'Library.staticwebassets.endpoints.json'));
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

describe('discoverManifests — dotnetOutputDir (explicit, publish dir)', () => {
  it('finds the endpoints sibling and returns null runtime path when file is absent', () => {
    const result = discoverManifests({
      projectName: 'Library',
      dotnetOutputDir: PUBLISH_DIR,
    });
    expect(result.runtimeManifestPath).toBeNull();
    expect(result.endpointsManifestPath).toBe(join(PUBLISH_DIR, 'Library.staticwebassets.endpoints.json'));
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

describe('discoverManifests — synthetic missing manifest', () => {
  it('throws when no manifest exists in the TFM dir', () => {
    expect(() => discoverManifests({ projectRoot: join(tmpdir(), `dotnet-wasm-bundler-discover-test-${Date.now()}`), projectName: 'SomeProj', targetFramework: 'net10.0' })).toThrowError(/Endpoints manifest not found/);
  });

  it('throws when the configuration directory does not exist', () => {
    expect(() => discoverManifests({ projectRoot: join(tmpdir(), `dotnet-wasm-bundler-discover-test-${Date.now()}`), projectName: 'Proj', configuration: 'Release' })).toThrowError(/Endpoints manifest not found/);
  });
});
