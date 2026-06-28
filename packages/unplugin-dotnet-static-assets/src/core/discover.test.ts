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

describe('discoverManifests — synthetic missing manifest', () => {
  it('throws when no manifest exists in the TFM dir', () => {
    expect(() => discoverManifests({ projectRoot: join(tmpdir(), `dotnet-wasm-bundler-discover-test-${Date.now()}`), projectName: 'SomeProj', targetFramework: 'net10.0' })).toThrowError(/Endpoints manifest not found/);
  });

  it('throws when the configuration directory does not exist', () => {
    expect(() => discoverManifests({ projectRoot: join(tmpdir(), `dotnet-wasm-bundler-discover-test-${Date.now()}`), projectName: 'Proj', configuration: 'Release' })).toThrowError(/Endpoints manifest not found/);
  });
});
