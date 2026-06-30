import { resolve, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { discoverManifests } from './discover.js';

const SAMPLE_ROOT = resolve(__dirname, '../../../samples/SampleLibrary');
const EXPECTED_MANIFEST = resolve(
  SAMPLE_ROOT,
  'bin/Debug/net10.0/SampleLibrary.staticwebassets.runtime.json',
);
const PUBLISH_DIR = resolve(SAMPLE_ROOT, 'bin/Release/net10.0/publish');

describe('discoverManifests with real fixture', () => {
  it('finds both manifests with explicit TFM', () => {
    const result = discoverManifests({ projectRoot: SAMPLE_ROOT, projectName: 'SampleLibrary', targetFramework: 'net10.0' });
    expect(result.runtimeManifestPath).toBe(EXPECTED_MANIFEST);
    expect(result.endpointsManifestPath).toMatch(/SampleLibrary\.staticwebassets\.endpoints\.json$/);
  });

  it('finds the manifest with all axes explicit', () => {
    const result = discoverManifests({
      projectRoot: SAMPLE_ROOT,
      projectName: 'SampleLibrary',
      configuration: 'Debug',
      targetFramework: 'net10.0',
    });
    expect(result.runtimeManifestPath).toBe(EXPECTED_MANIFEST);
  });

  it('throws for an unbuilt configuration', () => {
    expect(() => discoverManifests({ projectRoot: SAMPLE_ROOT, projectName: 'SampleLibrary', configuration: 'Release' })).toThrowError(/Endpoints manifest not found/);
  });

  it('throws for an unknown targetFramework', () => {
    expect(() => discoverManifests({ projectRoot: SAMPLE_ROOT, projectName: 'SampleLibrary', targetFramework: 'net8.0' })).toThrowError(/Endpoints manifest not found/);
  });
});

describe('discoverManifests with real publish fixture', () => {
  it('finds the endpoints manifest under bin/Release/net10.0/publish/', () => {
    const result = discoverManifests({
      projectRoot: SAMPLE_ROOT,
      projectName: 'SampleLibrary',
      configuration: 'Release',
      targetFramework: 'net10.0',
      isPublish: true,
    });
    expect(result.endpointsManifestPath).toBe(join(PUBLISH_DIR, 'SampleLibrary.staticwebassets.endpoints.json'));
  });

  it('returns runtimeManifestPath as null (publish does not emit runtime.json)', () => {
    const result = discoverManifests({
      projectRoot: SAMPLE_ROOT,
      projectName: 'SampleLibrary',
      configuration: 'Release',
      targetFramework: 'net10.0',
      isPublish: true,
    });
    expect(result.runtimeManifestPath).toBeNull();
  });

  it('throws when the publish directory does not exist', () => {
    expect(() =>
      discoverManifests({
        projectRoot: SAMPLE_ROOT,
        projectName: 'SampleLibrary',
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
      projectName: 'SampleLibrary',
      dotnetOutputDir: PUBLISH_DIR,
    });
    expect(result.runtimeManifestPath).toBeNull();
    expect(result.endpointsManifestPath).toBe(join(PUBLISH_DIR, 'SampleLibrary.staticwebassets.endpoints.json'));
  });

  it('throws when given a file path instead of a directory (regression: old manifestPath shape)', () => {
    expect(() =>
      discoverManifests({
        projectName: 'SampleLibrary',
        dotnetOutputDir: join(PUBLISH_DIR, 'SampleLibrary.staticwebassets.runtime.json'),
      }),
    ).toThrowError(/Endpoints manifest not found/);
  });
});

const NONEXISTENT_ROOT = resolve(__dirname, '../../.test-tmp/does-not-exist');

describe('discoverManifests with missing manifest', () => {
  it('throws when no manifest exists in the TFM dir', () => {
    expect(() => discoverManifests({ projectRoot: NONEXISTENT_ROOT, projectName: 'SomeProj', targetFramework: 'net10.0' })).toThrowError(/Endpoints manifest not found/);
  });

  it('throws when the configuration directory does not exist', () => {
    expect(() => discoverManifests({ projectRoot: NONEXISTENT_ROOT, projectName: 'Proj', configuration: 'Release' })).toThrowError(/Endpoints manifest not found/);
  });
});
