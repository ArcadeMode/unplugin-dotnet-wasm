import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseEndpointsManifest, type EndpointsManifest } from './manifest-endpoints.js';
import {
  buildEndpointLookup,
  EndpointLookupBuildError,
  type EndpointMatch,
} from './endpoint-lookup.js';

const FIXTURE_MANIFEST = resolve(
  __dirname,
  '../../../../test/fixtures/Library/bin/Debug/net10.0/Library.staticwebassets.endpoints.json',
);

function loadFixture(): EndpointsManifest {
  return parseEndpointsManifest(readFileSync(FIXTURE_MANIFEST, 'utf8'));
}

// ---------------------------------------------------------------------------
// Helper to build a minimal manifest for unit tests
// ---------------------------------------------------------------------------
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

describe('buildEndpointLookup', () => {
  // -------------------------------------------------------------------------
  // Integration — real fixture
  // -------------------------------------------------------------------------

  it('builds without errors from the real Library fixture', () => {
    expect(() => buildEndpointLookup(loadFixture())).not.toThrow();
  });

  it('returns a non-empty ReadonlyMap', () => {
    const lookup = buildEndpointLookup(loadFixture());
    expect(lookup.size).toBeGreaterThan(0);
  });

  it('canonical route _framework/Library.wasm is present', () => {
    const lookup = buildEndpointLookup(loadFixture());
    expect(lookup.has('_framework/Library.wasm')).toBe(true);
  });

  it('canonical route _framework/dotnet.js is present', () => {
    const lookup = buildEndpointLookup(loadFixture());
    expect(lookup.has('_framework/dotnet.js')).toBe(true);
  });

  it('_framework/dotnet.js assetFile resolves to the correct filename (fingerprinted or canonical)', () => {
    const lookup = buildEndpointLookup(loadFixture());
    const match = lookup.get('_framework/dotnet.js') as EndpointMatch;
    expect(match.assetFile).toMatch(/^_framework\/dotnet(\.[a-z0-9]+)?\.js$/);
  });

  it('_framework/Library.wasm assetFile resolves to the correct filename (fingerprinted or canonical)', () => {
    const lookup = buildEndpointLookup(loadFixture());
    const match = lookup.get('_framework/Library.wasm') as EndpointMatch;
    expect(match.assetFile).toMatch(/^_framework\/Library(\.[a-z0-9]+)?\.wasm$/);
  });

  it('at least one entry has an integrity value', () => {
    const lookup = buildEndpointLookup(loadFixture());
    const entries = [...lookup.values()];
    expect(entries.some(m => m.integrity !== undefined)).toBe(true);
  });

  it('at least one entry has a fingerprint value', () => {
    const lookup = buildEndpointLookup(loadFixture());
    const entries = [...lookup.values()];
    expect(entries.some(m => m.fingerprint !== undefined)).toBe(true);
  });

  it('the fingerprinted route for Library.wasm carries a label back to canonical', () => {
    const manifest = loadFixture();
    // Find the fingerprinted Route row — absent when WasmFingerprintAssets=false.
    const fpEndpoint = manifest.Endpoints.find(e =>
      /^_framework\/Library\.[a-z0-9]+\.wasm$/.test(e.Route),
    );
    if (!fpEndpoint) return; // no separate fingerprinted route when fingerprinting is disabled
    const lookup = buildEndpointLookup(manifest);
    const fpRoute = fpEndpoint!.Route;
    const match = lookup.get(fpRoute) as EndpointMatch;
    expect(match.label).toBe('_framework/Library.wasm');
  });

  // -------------------------------------------------------------------------
  // Route normalisation
  // -------------------------------------------------------------------------

  it('strips a leading slash from Route', () => {
    const lookup = buildEndpointLookup(
      makeManifest([makeEndpoint('/_framework/foo.js', '_framework/foo.abc123.js')]),
    );
    expect(lookup.has('_framework/foo.js')).toBe(true);
  });

  it('normalises backslashes to forward slashes in Route', () => {
    const lookup = buildEndpointLookup(
      makeManifest([makeEndpoint('_framework\\foo.js', '_framework/foo.abc123.js')]),
    );
    expect(lookup.has('_framework/foo.js')).toBe(true);
  });

  it('normalises backslashes to forward slashes in AssetFile', () => {
    const lookup = buildEndpointLookup(
      makeManifest([makeEndpoint('_framework/foo.js', '_framework\\foo.abc123.js')]),
    );
    expect(lookup.get('_framework/foo.js')?.assetFile).toBe('_framework/foo.abc123.js');
  });

  // -------------------------------------------------------------------------
  // Compressed-variant filtering
  // -------------------------------------------------------------------------

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
    const lookup = buildEndpointLookup(manifest);
    expect(lookup.size).toBe(1);
  });

  it('two compressed variants for the same route are both skipped, leaving the canonical', () => {
    const manifest = makeManifest([
      makeEndpoint('_framework/foo.js', '_framework/foo.abc.js'),
      makeEndpoint('_framework/foo.js', '_framework/foo.abc.js.br', [], [
        { Name: 'Content-Encoding', Value: 'br' },
      ]),
      makeEndpoint('_framework/foo.js', '_framework/foo.abc.js.gz', [], [
        { Name: 'Content-Encoding', Value: 'gzip' },
      ]),
    ]);
    expect(buildEndpointLookup(manifest).size).toBe(1);
  });

  // -------------------------------------------------------------------------
  // EndpointProperty extraction
  // -------------------------------------------------------------------------

  it('extracts integrity from EndpointProperties', () => {
    const lookup = buildEndpointLookup(
      makeManifest([
        makeEndpoint('_framework/foo.wasm', '_framework/foo.abc.wasm', [
          { Name: 'integrity', Value: 'sha256-abc=' },
        ]),
      ]),
    );
    expect(lookup.get('_framework/foo.wasm')?.integrity).toBe('sha256-abc=');
  });

  it('extracts fingerprint from EndpointProperties', () => {
    const lookup = buildEndpointLookup(
      makeManifest([
        makeEndpoint('_framework/foo.wasm', '_framework/foo.abc.wasm', [
          { Name: 'fingerprint', Value: 'abc' },
        ]),
      ]),
    );
    expect(lookup.get('_framework/foo.wasm')?.fingerprint).toBe('abc');
  });

  it('extracts label from EndpointProperties', () => {
    const lookup = buildEndpointLookup(
      makeManifest([
        makeEndpoint('_framework/foo.abc.wasm', '_framework/foo.abc.wasm', [
          { Name: 'label', Value: '_framework/foo.wasm' },
        ]),
      ]),
    );
    expect(lookup.get('_framework/foo.abc.wasm')?.label).toBe('_framework/foo.wasm');
  });

  it('leaves integrity undefined when not present', () => {
    const lookup = buildEndpointLookup(
      makeManifest([makeEndpoint('_framework/foo.js', '_framework/foo.abc.js')]),
    );
    expect(lookup.get('_framework/foo.js')?.integrity).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Error paths
  // -------------------------------------------------------------------------

  it('throws EndpointLookupBuildError on duplicate uncompressed routes', () => {
    const manifest = makeManifest([
      makeEndpoint('_framework/foo.js', '_framework/foo.abc.js'),
      makeEndpoint('_framework/foo.js', '_framework/foo.def.js'),
    ]);
    expect(() => buildEndpointLookup(manifest)).toThrow(EndpointLookupBuildError);
  });

  it('error carries the offending route', () => {
    const manifest = makeManifest([
      makeEndpoint('_framework/foo.js', '_framework/foo.abc.js'),
      makeEndpoint('_framework/foo.js', '_framework/foo.def.js'),
    ]);
    try {
      buildEndpointLookup(manifest);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(EndpointLookupBuildError);
      expect((e as EndpointLookupBuildError).route).toBe('_framework/foo.js');
    }
  });

  it('returns an empty map for a manifest with no endpoints', () => {
    expect(buildEndpointLookup(makeManifest([])).size).toBe(0);
  });
});
