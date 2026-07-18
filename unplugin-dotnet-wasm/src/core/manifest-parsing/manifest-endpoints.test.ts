import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseEndpointsManifest, EndpointsManifestParseError } from './manifest-endpoints';

const FIXTURE_MANIFEST = resolve(
  __dirname,
  '../../../../samples/SampleLibrary/bin/Debug/net10.0/SampleLibrary.staticwebassets.endpoints.json',
);

describe('parseEndpointsManifest', () => {
  // Happy path - real manifest from the SampleLibrary fixture
  it('parses the real SampleLibrary manifest without errors', () => {
    const raw = readFileSync(FIXTURE_MANIFEST, 'utf8');
    expect(() => parseEndpointsManifest(raw)).not.toThrow();
  });

  it('returns Version 1 and ManifestType "Build"', () => {
    const manifest = parseEndpointsManifest(readFileSync(FIXTURE_MANIFEST, 'utf8'));
    expect(manifest.Version).toBe(1);
    expect(manifest.ManifestType).toBe('Build');
  });

  it('has at least 100 endpoints', () => {
    const manifest = parseEndpointsManifest(readFileSync(FIXTURE_MANIFEST, 'utf8'));
    expect(manifest.Endpoints.length).toBeGreaterThanOrEqual(100);
  });

  it('contains a canonical _framework/SampleLibrary.wasm endpoint with a resolved AssetFile', () => {
    const manifest = parseEndpointsManifest(readFileSync(FIXTURE_MANIFEST, 'utf8'));
    const ep = manifest.Endpoints.find((e) => e.Route === '_framework/SampleLibrary.wasm');
    expect(ep).toBeDefined();
    expect(ep!.AssetFile).toMatch(/^_framework\/SampleLibrary(\.[a-z0-9]+)?\.wasm$/);
  });

  it('contains a canonical _framework/dotnet.js endpoint with a resolved AssetFile', () => {
    const manifest = parseEndpointsManifest(readFileSync(FIXTURE_MANIFEST, 'utf8'));
    const ep = manifest.Endpoints.find((e) => e.Route === '_framework/dotnet.js');
    expect(ep).toBeDefined();
    expect(ep!.AssetFile).toMatch(/^_framework\/dotnet(\.[a-z0-9]+)?\.js$/);
  });

  it('contains a canonical _framework/dotnet.native.wasm endpoint', () => {
    const manifest = parseEndpointsManifest(readFileSync(FIXTURE_MANIFEST, 'utf8'));
    const ep = manifest.Endpoints.find((e) => e.Route === '_framework/dotnet.native.wasm');
    expect(ep).toBeDefined();
    expect(ep!.AssetFile).toMatch(/^_framework\/dotnet\.native(\.[a-z0-9]+)?\.wasm$/);
  });

  it('at least one endpoint has a "fingerprint" EndpointProperty', () => {
    const manifest = parseEndpointsManifest(readFileSync(FIXTURE_MANIFEST, 'utf8'));
    const hasFp = manifest.Endpoints.some((e) =>
      e.EndpointProperties.some((p) => p.Name === 'fingerprint'),
    );
    expect(hasFp).toBe(true);
  });

  it('at least one endpoint has a "label" EndpointProperty', () => {
    const manifest = parseEndpointsManifest(readFileSync(FIXTURE_MANIFEST, 'utf8'));
    const hasLabel = manifest.Endpoints.some((e) =>
      e.EndpointProperties.some((p) => p.Name === 'label'),
    );
    expect(hasLabel).toBe(true);
  });

  it('all endpoints have Selectors as an array (even if empty)', () => {
    const manifest = parseEndpointsManifest(readFileSync(FIXTURE_MANIFEST, 'utf8'));
    expect(manifest.Endpoints.every((e) => Array.isArray(e.Selectors))).toBe(true);
  });

  it('all endpoints have at least one ResponseHeader', () => {
    const manifest = parseEndpointsManifest(readFileSync(FIXTURE_MANIFEST, 'utf8'));
    expect(manifest.Endpoints.every((e) => e.ResponseHeaders.length > 0)).toBe(true);
  });

  it('accepts a Buffer input', () => {
    const buf = readFileSync(FIXTURE_MANIFEST);
    expect(() => parseEndpointsManifest(buf)).not.toThrow();
  });

  // Error cases
  it('throws EndpointsManifestParseError on invalid JSON', () => {
    expect(() => parseEndpointsManifest('{ not json')).toThrow(EndpointsManifestParseError);
  });

  it('throws EndpointsManifestParseError when Endpoints is missing', () => {
    expect(() =>
      parseEndpointsManifest(JSON.stringify({ Version: 1, ManifestType: 'Build' })),
    ).toThrow(EndpointsManifestParseError);
  });

  it('throws EndpointsManifestParseError when Endpoints is not an array', () => {
    expect(() =>
      parseEndpointsManifest(
        JSON.stringify({ Version: 1, ManifestType: 'Build', Endpoints: 'bad' }),
      ),
    ).toThrow(EndpointsManifestParseError);
  });

  it('throws EndpointsManifestParseError when an Endpoint is missing Route', () => {
    expect(() =>
      parseEndpointsManifest(
        JSON.stringify({
          Version: 1,
          ManifestType: 'Build',
          Endpoints: [
            { AssetFile: 'a.wasm', Selectors: [], ResponseHeaders: [], EndpointProperties: [] },
          ],
        }),
      ),
    ).toThrow(EndpointsManifestParseError);
  });

  it('error message includes the offending path', () => {
    try {
      parseEndpointsManifest(JSON.stringify({ Version: 1, ManifestType: 'Build' }));
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(EndpointsManifestParseError);
      expect((e as EndpointsManifestParseError).message).toMatch(/Endpoints/);
    }
  });
});
