import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { discoverRuntimeManifest, DiscoveryError } from './discover.js';

// ---------------------------------------------------------------------------
// Real fixture
// ---------------------------------------------------------------------------

const LIBRARY_ROOT = resolve(__dirname, '../../../../test/fixtures/Library');
const EXPECTED_MANIFEST = resolve(
  LIBRARY_ROOT,
  'bin/Debug/net10.0/Library.staticwebassets.runtime.json',
);

describe('discoverRuntimeManifest — real fixture', () => {
  it('finds the manifest with default options (Debug, auto-TFM)', () => {
    const result = discoverRuntimeManifest({ projectRoot: LIBRARY_ROOT });
    expect(result.manifestPath).toBe(EXPECTED_MANIFEST);
    expect(result.projectName).toBe('Library');
    expect(result.resolvedConfiguration).toBe('Debug');
    expect(result.resolvedTargetFramework).toBe('net10.0');
  });

  it('finds the manifest with all axes explicit', () => {
    const result = discoverRuntimeManifest({
      projectRoot: LIBRARY_ROOT,
      configuration: 'Debug',
      targetFramework: 'net10.0',
    });
    expect(result.manifestPath).toBe(EXPECTED_MANIFEST);
  });

  it('manifestPath bypass skips all discovery', () => {
    const result = discoverRuntimeManifest({
      projectRoot: LIBRARY_ROOT,
      manifestPath: EXPECTED_MANIFEST,
    });
    expect(result.manifestPath).toBe(EXPECTED_MANIFEST);
    // When bypassed, configuration/TFM are reported as 'unknown'
    expect(result.resolvedConfiguration).toBe('unknown');
    expect(result.resolvedTargetFramework).toBe('unknown');
  });

  it('throws DiscoveryError for wrong configuration', () => {
    expect(() =>
      discoverRuntimeManifest({ projectRoot: LIBRARY_ROOT, configuration: 'Release' }),
    ).toThrowError(DiscoveryError);
  });

  it('throws DiscoveryError for wrong targetFramework', () => {
    expect(() =>
      discoverRuntimeManifest({
        projectRoot: LIBRARY_ROOT,
        configuration: 'Debug',
        targetFramework: 'net8.0',
      }),
    ).toThrowError(DiscoveryError);
  });
});

// ---------------------------------------------------------------------------
// Synthetic fixtures — built in a temp directory
// ---------------------------------------------------------------------------

let tmpRoot: string;

beforeAll(() => {
  tmpRoot = join(tmpdir(), `dotnet-wasm-bundler-discover-test-${Date.now()}`);
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

/** Creates a minimal manifest placeholder at the given absolute path. */
function touchManifest(absPath: string): void {
  mkdirSync(resolve(absPath, '..'), { recursive: true });
  writeFileSync(absPath, '{"ContentRoots":[],"Root":{"Children":null,"Asset":null,"Patterns":null}}');
}

describe('discoverRuntimeManifest — synthetic multi-TFM', () => {
  it('fails with a clear error listing both TFMs when multiple exist', () => {
    const root = join(tmpRoot, 'multi-tfm');
    touchManifest(join(root, 'bin/Debug/net8.0/Proj.staticwebassets.runtime.json'));
    touchManifest(join(root, 'bin/Debug/net10.0/Proj.staticwebassets.runtime.json'));

    let caught: DiscoveryError | undefined;
    try {
      discoverRuntimeManifest({ projectRoot: root, configuration: 'Debug' });
    } catch (e) {
      caught = e as DiscoveryError;
    }
    expect(caught).toBeInstanceOf(DiscoveryError);
    expect(caught?.message).toMatch(/net8\.0/);
    expect(caught?.message).toMatch(/net10\.0/);
    expect(caught?.message).toMatch(/targetFramework/);
  });

  it('succeeds when targetFramework is explicit with multiple TFMs present', () => {
    const root = join(tmpRoot, 'multi-tfm-explicit');
    touchManifest(join(root, 'bin/Debug/net8.0/Proj.staticwebassets.runtime.json'));
    touchManifest(join(root, 'bin/Debug/net10.0/Proj.staticwebassets.runtime.json'));

    const result = discoverRuntimeManifest({
      projectRoot: root,
      configuration: 'Debug',
      targetFramework: 'net10.0',
    });
    expect(result.manifestPath).toContain('net10.0');
    expect(result.resolvedTargetFramework).toBe('net10.0');
  });
});

describe('discoverRuntimeManifest — synthetic missing manifest', () => {
  it('throws DiscoveryError with the searched path when no manifest exists', () => {
    const root = join(tmpRoot, 'no-manifest');
    mkdirSync(join(root, 'bin/Debug/net10.0'), { recursive: true });

    let caught: DiscoveryError | undefined;
    try {
      discoverRuntimeManifest({ projectRoot: root });
    } catch (e) {
      caught = e as DiscoveryError;
    }
    expect(caught).toBeInstanceOf(DiscoveryError);
    expect(caught?.message).toMatch(/net10\.0/);
    expect(caught?.message).toMatch(/dotnet build/);
  });

  it('throws DiscoveryError with the config dir in the message when bin/<cfg> missing', () => {
    const root = join(tmpRoot, 'no-config-dir');
    mkdirSync(root, { recursive: true });

    let caught: DiscoveryError | undefined;
    try {
      discoverRuntimeManifest({ projectRoot: root, configuration: 'Release' });
    } catch (e) {
      caught = e as DiscoveryError;
    }
    expect(caught).toBeInstanceOf(DiscoveryError);
    expect(caught?.message).toMatch(/Release/);
    expect(caught?.message).toMatch(/dotnet build/);
  });
});

describe('discoverRuntimeManifest — manifestPath bypass errors', () => {
  it('throws when explicit manifestPath does not exist', () => {
    expect(() =>
      discoverRuntimeManifest({
        projectRoot: LIBRARY_ROOT,
        manifestPath: '/nonexistent/path/Foo.staticwebassets.runtime.json',
      }),
    ).toThrowError(DiscoveryError);
  });
});
