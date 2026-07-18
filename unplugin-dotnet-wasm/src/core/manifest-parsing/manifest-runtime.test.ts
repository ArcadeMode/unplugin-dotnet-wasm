import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseRuntimeManifest, ManifestParseError } from './manifest-runtime';

const FIXTURE_MANIFEST = resolve(
  __dirname,
  '../../../../samples/SampleLibrary/bin/Debug/net10.0/SampleLibrary.staticwebassets.runtime.json',
);

describe('parseRuntimeManifest', () => {
  it('parses the real SampleLibrary manifest without errors', () => {
    const raw = readFileSync(FIXTURE_MANIFEST, 'utf8');
    expect(() => parseRuntimeManifest(raw)).not.toThrow();
  });

  it('returns at least one content root', () => {
    const manifest = parseRuntimeManifest(readFileSync(FIXTURE_MANIFEST, 'utf8'));
    expect(manifest.ContentRoots.length).toBeGreaterThanOrEqual(1);
  });

  it('all content roots are absolute paths ending with a separator', () => {
    const manifest = parseRuntimeManifest(readFileSync(FIXTURE_MANIFEST, 'utf8'));
    for (const root of manifest.ContentRoots) {
      expect(root).toMatch(/[/\\]$/);
      expect(root).toMatch(/^[A-Z]:[/\\]|^\//);
    }
  });

  it('one content root contains the bin output wwwroot', () => {
    const manifest = parseRuntimeManifest(readFileSync(FIXTURE_MANIFEST, 'utf8'));
    expect(
      manifest.ContentRoots.some((r) => /bin[/\\]Debug[/\\]net10\.0[/\\]wwwroot[/\\]$/.test(r)),
    ).toBe(true);
  });

  it('_framework contains a fingerprinted dotnet.*.js asset', () => {
    const manifest = parseRuntimeManifest(readFileSync(FIXTURE_MANIFEST, 'utf8'));
    const frameworkChildren = manifest.Root.Children?.['_framework']?.Children ?? {};
    const key = Object.keys(frameworkChildren).find((k) => /^dotnet\.[a-z0-9]+\.js$/.test(k));
    expect(key, 'expected a fingerprinted dotnet.*.js entry in _framework').toBeDefined();
    const asset = frameworkChildren[key!]?.Asset;
    expect(asset).not.toBeNull();
    expect(asset?.SubPath).toMatch(/^_framework\/dotnet\.[a-z0-9]+\.js$/);
  });

  it('_framework contains a SampleLibrary.wasm asset (fingerprinted or canonical)', () => {
    const manifest = parseRuntimeManifest(readFileSync(FIXTURE_MANIFEST, 'utf8'));
    const frameworkChildren = manifest.Root.Children?.['_framework']?.Children ?? {};
    const key = Object.keys(frameworkChildren).find((k) =>
      /^SampleLibrary(\.[a-z0-9]+)?\.wasm$/.test(k),
    );
    expect(key, 'expected a SampleLibrary.wasm entry in _framework').toBeDefined();
    const asset = frameworkChildren[key!]?.Asset;
    expect(asset).not.toBeNull();
  });

  it('accepts a Buffer as input', () => {
    const buf = readFileSync(FIXTURE_MANIFEST);
    expect(() => parseRuntimeManifest(buf)).not.toThrow();
  });

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
