import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  parseRuntimeManifest,
  ManifestParseError,
} from './manifest-runtime.js';

// Path to the real build output — the fixture we're grounding everything in.
const FIXTURE_MANIFEST = resolve(
  __dirname,
  '../../../../test/fixtures/Library/bin/Debug/net10.0/Library.staticwebassets.runtime.json',
);

describe('parseRuntimeManifest', () => {
  // -------------------------------------------------------------------------
  // Happy path — real manifest from the Library fixture
  // -------------------------------------------------------------------------

  it('parses the real Library manifest without errors', () => {
    const raw = readFileSync(FIXTURE_MANIFEST, 'utf8');
    expect(() => parseRuntimeManifest(raw)).not.toThrow();
  });

  it('returns exactly three content roots', () => {
    const manifest = parseRuntimeManifest(readFileSync(FIXTURE_MANIFEST, 'utf8'));
    expect(manifest.ContentRoots).toHaveLength(3);
  });

  it('content root 0 ends with Library/wwwroot/', () => {
    const manifest = parseRuntimeManifest(readFileSync(FIXTURE_MANIFEST, 'utf8'));
    expect(manifest.ContentRoots[0]).toMatch(/Library[/\\]wwwroot[/\\]$/);
  });

  it('content root 1 is the TypeShim generated assets directory (obj/…/TypeShim/…/wwwroot/)', () => {
    const manifest = parseRuntimeManifest(readFileSync(FIXTURE_MANIFEST, 'utf8'));
    expect(manifest.ContentRoots[1]).toMatch(/TypeShim[/\\]staticwebassets[/\\]wwwroot[/\\]$/);
  });

  it('content root 2 ends with bin/Debug/net10.0/wwwroot/', () => {
    const manifest = parseRuntimeManifest(readFileSync(FIXTURE_MANIFEST, 'utf8'));
    expect(manifest.ContentRoots[2]).toMatch(/bin[/\\]Debug[/\\]net10\.0[/\\]wwwroot[/\\]$/);
  });

  it('_framework/dotnet.d.ts is an asset in content root 0 (source)', () => {
    const manifest = parseRuntimeManifest(readFileSync(FIXTURE_MANIFEST, 'utf8'));
    const frameworkNode = manifest.Root.Children?.['_framework'];
    expect(frameworkNode).toBeDefined();
    const asset = frameworkNode?.Children?.['dotnet.d.ts']?.Asset;
    expect(asset).not.toBeNull();
    expect(asset?.ContentRootIndex).toBe(0);
    expect(asset?.SubPath).toBe('_framework/dotnet.d.ts');
  });

  it('_framework/dotnet.js is an asset in content root 2 (build output)', () => {
    const manifest = parseRuntimeManifest(readFileSync(FIXTURE_MANIFEST, 'utf8'));
    const asset = manifest.Root.Children?.['_framework']?.Children?.['dotnet.js']?.Asset;
    expect(asset).not.toBeNull();
    expect(asset?.ContentRootIndex).toBe(2);
    expect(asset?.SubPath).toBe('_framework/dotnet.js');
  });

  it('_framework/Library.wasm is an asset in content root 2', () => {
    const manifest = parseRuntimeManifest(readFileSync(FIXTURE_MANIFEST, 'utf8'));
    const asset = manifest.Root.Children?.['_framework']?.Children?.['Library.wasm']?.Asset;
    expect(asset).not.toBeNull();
    expect(asset?.ContentRootIndex).toBe(2);
  });

  it('root has a fall-through Pattern pointing at content root 0', () => {
    const manifest = parseRuntimeManifest(readFileSync(FIXTURE_MANIFEST, 'utf8'));
    const patterns = manifest.Root.Patterns;
    expect(patterns).not.toBeNull();
    expect(patterns?.length).toBeGreaterThanOrEqual(1);
    expect(patterns?.[0]?.ContentRootIndex).toBe(0);
    expect(patterns?.[0]?.Pattern).toBe('**');
  });

  it('accepts a Buffer as input', () => {
    const buf = readFileSync(FIXTURE_MANIFEST);
    expect(() => parseRuntimeManifest(buf)).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Error cases
  // -------------------------------------------------------------------------

  it('throws ManifestParseError for invalid JSON', () => {
    expect(() => parseRuntimeManifest('not json {')).toThrowError(ManifestParseError);
    expect(() => parseRuntimeManifest('not json {')).toThrow(/not valid JSON/);
  });

  it('throws ManifestParseError when ContentRoots is missing', () => {
    const bad = JSON.stringify({ Root: { Children: null, Asset: null, Patterns: null } });
    expect(() => parseRuntimeManifest(bad)).toThrowError(ManifestParseError);
    expect(() => parseRuntimeManifest(bad)).toThrow(/schema validation/);
  });

  it('throws ManifestParseError when an Asset has a negative ContentRootIndex', () => {
    const bad = JSON.stringify({
      ContentRoots: ['C:/foo/'],
      Root: {
        Children: {
          'main.ts': {
            Children: null,
            Asset: { ContentRootIndex: -1, SubPath: 'main.ts' },
            Patterns: null,
          },
        },
        Asset: null,
        Patterns: null,
      },
    });
    expect(() => parseRuntimeManifest(bad)).toThrowError(ManifestParseError);
  });

  it('error message includes the failing JSON path', () => {
    const bad = JSON.stringify({
      ContentRoots: [42], // should be string
      Root: { Children: null, Asset: null, Patterns: null },
    });
    let caught: ManifestParseError | undefined;
    try {
      parseRuntimeManifest(bad);
    } catch (e) {
      caught = e as ManifestParseError;
    }
    expect(caught).toBeInstanceOf(ManifestParseError);
    expect(caught?.issues.length).toBeGreaterThan(0);
    // The path should reference ContentRoots
    expect(caught?.message).toMatch(/ContentRoots/);
  });
});
