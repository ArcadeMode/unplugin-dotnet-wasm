import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  parseEndpointsManifest,
  type EndpointsManifest,
} from '../manifest-parsing/manifest-endpoints';
import { normalizePath } from '../path-utils';
import { EndpointLookup, DuplicatePathError, type EndpointMatch } from './endpoint-lookup';

const FIXTURE_MANIFEST = resolve(
  __dirname,
  '../../../../samples/SampleLibrary/bin/Debug/net10.0/SampleLibrary.staticwebassets.endpoints.json',
);

function loadFixture(): EndpointsManifest {
  return parseEndpointsManifest(readFileSync(FIXTURE_MANIFEST, 'utf8'));
}

function makeManifest(endpoints: EndpointsManifest['Endpoints']): EndpointsManifest {
  return { Version: 1, ManifestType: 'Build', Endpoints: endpoints };
}

function makeEndpoint(
  route: string,
  assetFile: string,
  props: Array<{ Name: string; Value: string }> = [],
  selectors: Array<{ Name: string; Value: string }> = [],
) {
  return {
    Route: route,
    AssetFile: assetFile,
    Selectors: selectors,
    ResponseHeaders: [{ Name: 'Content-Type', Value: 'application/octet-stream' }],
    EndpointProperties: props,
  };
}

describe('EndpointLookup', () => {
  it('builds without errors from the real SampleLibrary fixture', () => {
    expect(() => new EndpointLookup(loadFixture())).not.toThrow();
  });

  it('returns a non-empty ReadonlyMap', () => {
    const lookup = new EndpointLookup(loadFixture());
    expect(lookup.size).toBeGreaterThan(0);
  });

  it('canonical route _framework/SampleLibrary.wasm is present', () => {
    const lookup = new EndpointLookup(loadFixture());
    // The map is keyed by the case-folded lookupKey; query the way consumers do.
    expect(lookup.has(normalizePath('_framework/SampleLibrary.wasm'))).toBe(true);
  });

  it('canonical route _framework/dotnet.js is present', () => {
    const lookup = new EndpointLookup(loadFixture());
    expect(lookup.has(normalizePath('_framework/dotnet.js'))).toBe(true);
  });

  it('_framework/dotnet.js assetFile resolves to the correct filename (fingerprinted or canonical)', () => {
    const lookup = new EndpointLookup(loadFixture());
    const match = lookup.get(normalizePath('_framework/dotnet.js')) as EndpointMatch;
    expect(match.assetFile).toMatch(/^_framework\/dotnet(\.[a-z0-9]+)?\.js$/);
  });

  it('_framework/SampleLibrary.wasm assetFile resolves to the correct filename (fingerprinted or canonical)', () => {
    const lookup = new EndpointLookup(loadFixture());
    const match = lookup.get(normalizePath('_framework/SampleLibrary.wasm')) as EndpointMatch;
    expect(match.assetFile).toMatch(/^_framework\/SampleLibrary(\.[a-z0-9]+)?\.wasm$/);
  });

  it('at least one entry has a fingerprint value', () => {
    const lookup = new EndpointLookup(loadFixture());
    const entries = [...lookup.values()];
    expect(entries.some((m) => m.fingerprint !== undefined)).toBe(true);
  });

  it('the fingerprinted route for SampleLibrary.wasm carries a label back to canonical', () => {
    const manifest = loadFixture();
    const fpEndpoint = manifest.Endpoints.find((e) =>
      /^_framework\/SampleLibrary\.[a-z0-9]+\.wasm$/.test(e.Route),
    );
    expect(
      fpEndpoint,
      'SampleLibrary fixture must be built with WasmFingerprintAssets=true',
    ).toBeDefined();
    const match = new EndpointLookup(manifest).get(
      normalizePath(fpEndpoint!.Route),
    ) as EndpointMatch;
    expect(match.label).toBe('_framework/SampleLibrary.wasm');
  });

  it('strips a leading slash from Route', () => {
    const lookup = new EndpointLookup(
      makeManifest([makeEndpoint('/_framework/foo.js', '_framework/foo.abc123.js')]),
    );
    expect(lookup.has(normalizePath('_framework/foo.js'))).toBe(true);
  });

  it('normalises backslashes to forward slashes in Route', () => {
    const lookup = new EndpointLookup(
      makeManifest([makeEndpoint('_framework\\foo.js', '_framework/foo.abc123.js')]),
    );
    expect(lookup.has(normalizePath('_framework/foo.js'))).toBe(true);
  });

  it('normalises backslashes to forward slashes in AssetFile', () => {
    const lookup = new EndpointLookup(
      makeManifest([makeEndpoint('_framework/foo.js', '_framework\\foo.abc123.js')]),
    );
    expect(lookup.get(normalizePath('_framework/foo.js'))?.assetFile).toBe(
      '_framework/foo.abc123.js',
    );
  });

  it('skips endpoints with a Content-Encoding selector', () => {
    const manifest = makeManifest([
      makeEndpoint('_framework/foo.js', '_framework/foo.abc.js'),
      makeEndpoint(
        '_framework/foo.js',
        '_framework/foo.abc.js.br',
        [],
        [{ Name: 'Content-Encoding', Value: 'br' }],
      ),
    ]);
    // Only 1 uncompressed → should succeed, no duplicate error
    const lookup = new EndpointLookup(manifest);
    expect(lookup.size).toBe(1);
  });

  it('two compressed variants for the same route are both skipped, leaving the canonical', () => {
    const manifest = makeManifest([
      makeEndpoint('_framework/foo.js', '_framework/foo.abc.js'),
      makeEndpoint(
        '_framework/foo.js',
        '_framework/foo.abc.js.br',
        [],
        [{ Name: 'Content-Encoding', Value: 'br' }],
      ),
      makeEndpoint(
        '_framework/foo.js',
        '_framework/foo.abc.js.gz',
        [],
        [{ Name: 'Content-Encoding', Value: 'gzip' }],
      ),
    ]);
    expect(new EndpointLookup(manifest).size).toBe(1);
  });

  it('extracts fingerprint from EndpointProperties', () => {
    const lookup = new EndpointLookup(
      makeManifest([
        makeEndpoint('_framework/foo.wasm', '_framework/foo.abc.wasm', [
          { Name: 'fingerprint', Value: 'abc' },
        ]),
      ]),
    );
    expect(lookup.get(normalizePath('_framework/foo.wasm'))?.fingerprint).toBe('abc');
  });

  it('extracts label from EndpointProperties', () => {
    const lookup = new EndpointLookup(
      makeManifest([
        makeEndpoint('_framework/foo.abc.wasm', '_framework/foo.abc.wasm', [
          { Name: 'label', Value: '_framework/foo.wasm' },
        ]),
      ]),
    );
    expect(lookup.get(normalizePath('_framework/foo.abc.wasm'))?.label).toBe('_framework/foo.wasm');
  });

  it('throws DuplicatePathError on duplicate uncompressed routes', () => {
    const manifest = makeManifest([
      makeEndpoint('_framework/foo.js', '_framework/foo.abc.js'),
      makeEndpoint('_framework/foo.js', '_framework/foo.def.js'),
    ]);
    expect(() => new EndpointLookup(manifest)).toThrow(DuplicatePathError);
  });

  it('error carries the offending route', () => {
    const manifest = makeManifest([
      makeEndpoint('_framework/foo.js', '_framework/foo.abc.js'),
      makeEndpoint('_framework/foo.js', '_framework/foo.def.js'),
    ]);
    try {
      new EndpointLookup(manifest);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(DuplicatePathError);
      expect((e as DuplicatePathError).key).toBe('_framework/foo.js');
    }
  });

  it('returns an empty map for a manifest with no endpoints', () => {
    expect(new EndpointLookup(makeManifest([])).size).toBe(0);
  });

  it('populates responseHeaders from the endpoint', () => {
    const lookup = new EndpointLookup(
      makeManifest([makeEndpoint('_framework/foo.wasm', '_framework/foo.abc.wasm')]),
    );
    expect(lookup.get(normalizePath('_framework/foo.wasm'))?.responseHeaders).toEqual([
      { Name: 'Content-Type', Value: 'application/octet-stream' },
    ]);
  });
});
