import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AssetResolver } from './asset-resolver.js';
import { buildVfs, type VirtualFileSystem, type ResolvedAsset } from './vfs.js';
import { buildEndpointLookup } from './endpoint-lookup.js';
import type { EndpointLookup, EndpointMatch } from './endpoint-lookup.js';
import { parseRuntimeManifest } from './manifest-runtime.js';
import { parseEndpointsManifest } from './manifest-endpoints.js';

// ---------------------------------------------------------------------------
// Stub helpers
// ---------------------------------------------------------------------------

function stubVfs(opts?: {
  resolve?: VirtualFileSystem['resolve'];
  resolveFile?: VirtualFileSystem['resolveFile'];
}): VirtualFileSystem {
  return {
    list: () => [],
    resolve: opts?.resolve ?? vi.fn().mockReturnValue(undefined),
    resolveFile: opts?.resolveFile ?? vi.fn().mockReturnValue(undefined),
  };
}

function vfsAsset(physicalPath: string): ResolvedAsset {
  return { virtualPath: physicalPath, physicalPath };
}

// ---------------------------------------------------------------------------
// Input normalisation
// ---------------------------------------------------------------------------

describe('AssetResolver — input normalisation', () => {
  it('returns null for an empty string', () => {
    expect(new AssetResolver(stubVfs(), new Map()).resolve('')).toBeNull();
  });

  it('returns null for "./" (nothing after strip)', () => {
    expect(new AssetResolver(stubVfs(), new Map()).resolve('./')).toBeNull();
  });

  it('returns null for "/" (nothing after strip)', () => {
    expect(new AssetResolver(stubVfs(), new Map()).resolve('/')).toBeNull();
  });

  it('strips leading "./" before delegating to vfs.resolve', () => {
    const resolveFn = vi.fn().mockReturnValue(undefined);
    new AssetResolver(stubVfs({ resolve: resolveFn }), new Map()).resolve('./foo.ts');
    expect(resolveFn).toHaveBeenCalledWith('foo.ts');
    expect(resolveFn).not.toHaveBeenCalledWith('./foo.ts');
  });

  it('strips leading "/" before delegating to vfs.resolve', () => {
    const resolveFn = vi.fn().mockReturnValue(undefined);
    new AssetResolver(stubVfs({ resolve: resolveFn }), new Map()).resolve('/foo.ts');
    expect(resolveFn).toHaveBeenCalledWith('foo.ts');
    expect(resolveFn).not.toHaveBeenCalledWith('/foo.ts');
  });
});

// ---------------------------------------------------------------------------
// Probe expansion
// ---------------------------------------------------------------------------

describe('AssetResolver — probe expansion', () => {
  it('does not expand probes when the source already has a file extension', () => {
    const resolveFn = vi.fn().mockReturnValue(undefined);
    new AssetResolver(stubVfs({ resolve: resolveFn }), new Map()).resolve('foo.js');
    expect(resolveFn).toHaveBeenCalledTimes(1);
    expect(resolveFn).toHaveBeenCalledWith('foo.js');
  });

  it('returns the index.<ext> hit when no extension probe matches', () => {
    const resolveFn = vi.fn().mockImplementation((vp: string) =>
      vp === 'some-dir/index.ts' ? vfsAsset('/abs/some-dir/index.ts') : undefined,
    );
    const r = new AssetResolver(stubVfs({ resolve: resolveFn }), new Map());
    expect(r.resolve('some-dir')).toBe('/abs/some-dir/index.ts');
  });

  it('stops at the first VFS hit and returns its physicalPath', () => {
    const resolveFn = vi.fn().mockImplementation((vp: string) =>
      vp === 'bare.ts' ? vfsAsset('/abs/bare.ts') : undefined,
    );
    const r = new AssetResolver(stubVfs({ resolve: resolveFn }), new Map());
    expect(r.resolve('bare')).toBe('/abs/bare.ts');
    // 'bare' (miss) + 'bare.ts' (hit) = exactly 2 calls; no further probing
    expect(resolveFn).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Endpoint alias paths
// ---------------------------------------------------------------------------

describe('AssetResolver — endpoint alias paths', () => {
  const fpMatch: EndpointMatch = { assetFile: '_framework/dotnet.abc123.js' };
  const lookup: EndpointLookup = new Map([['_framework/dotnet.js', fpMatch]]);

  it('resolves via vfs.resolve(alias.assetFile) when the asset is in the VFS', () => {
    const resolveFn = vi.fn().mockImplementation((vp: string) =>
      vp === '_framework/dotnet.abc123.js'
        ? vfsAsset('/abs/_framework/dotnet.abc123.js')
        : undefined,
    );
    const r = new AssetResolver(stubVfs({ resolve: resolveFn }), lookup);
    expect(r.resolve('_framework/dotnet.js')).toBe('/abs/_framework/dotnet.abc123.js');
  });

  it('falls back to vfs.resolveFile(alias.assetFile) when the VFS map misses (§3.2 step 6)', () => {
    const resolveFileFn = vi.fn().mockReturnValue({ physicalPath: '/abs/_framework/dotnet.abc123.js' });
    const r = new AssetResolver(stubVfs({ resolveFile: resolveFileFn }), lookup);
    expect(r.resolve('_framework/dotnet.js')).toBe('/abs/_framework/dotnet.abc123.js');
    expect(resolveFileFn).toHaveBeenCalledWith('_framework/dotnet.abc123.js');
  });

  it('a VFS direct hit on a probe short-circuits before the endpoint lookup is consulted', () => {
    const resolveFn = vi.fn().mockReturnValue(vfsAsset('/abs/foo.ts'));
    // Spy on the lookup's get method; it must not be called.
    const lookupWithSpy = new Map<string, EndpointMatch>([['foo.ts', fpMatch]]);
    const getSpy = vi.spyOn(lookupWithSpy, 'get');
    const r = new AssetResolver(stubVfs({ resolve: resolveFn }), lookupWithSpy);
    expect(r.resolve('foo.ts')).toBe('/abs/foo.ts');
    expect(getSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Full miss
// ---------------------------------------------------------------------------

describe('AssetResolver — full miss', () => {
  it('returns null when both VFS and endpoint lookup miss for every probe', () => {
    expect(new AssetResolver(stubVfs(), new Map()).resolve('nonexistent.wasm')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Real fixture — end-to-end probing through a real VFS + endpoint lookup
// ---------------------------------------------------------------------------

const LIBRARY_ROOT = resolve(__dirname, '../../../../test/fixtures/Library');
const RUNTIME_MANIFEST = resolve(LIBRARY_ROOT, 'bin/Debug/net10.0/Library.staticwebassets.runtime.json');
const ENDPOINTS_MANIFEST = resolve(LIBRARY_ROOT, 'obj/Debug/staticwebassets.build.endpoints.json');
const ROOT0 = resolve(LIBRARY_ROOT, 'wwwroot');
const ROOT_OBJ1 = resolve(LIBRARY_ROOT, 'obj', 'Debug', 'net10.0', 'TypeShim', 'staticwebassets', 'wwwroot');

describe('AssetResolver — real fixture', () => {
  let r: AssetResolver;

  beforeAll(() => {
    const vfs = buildVfs(parseRuntimeManifest(readFileSync(RUNTIME_MANIFEST)));
    const endpoints = buildEndpointLookup(parseEndpointsManifest(readFileSync(ENDPOINTS_MANIFEST)));
    r = new AssetResolver(vfs, endpoints);
  });

  it('resolves extensionless wasm-bootstrap to wasm-bootstrap.ts in root 0', () => {
    expect(r.resolve('wasm-bootstrap')).toBe(join(ROOT0, 'wasm-bootstrap.ts'));
  });

  it('resolves extensionless main to main.ts in root 0', () => {
    expect(r.resolve('main')).toBe(join(ROOT0, 'main.ts'));
  });

  it('resolves extensionless typeshim to typeshim.ts in root 1 (TypeShim obj dir)', () => {
    expect(r.resolve('typeshim')).toBe(join(ROOT_OBJ1, 'typeshim.ts'));
  });
});

// ---------------------------------------------------------------------------
// Synthetic: probing through pattern fallthrough (real disk, no fixture)
// ---------------------------------------------------------------------------

describe('AssetResolver — probing through pattern fallthrough', () => {
  let tmpRoot: string;
  let root0: string;
  let r: AssetResolver;

  beforeAll(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'ar-probe-'));
    root0 = join(tmpRoot, 'root0');
    mkdirSync(join(root0, 'some-dir'), { recursive: true });
    writeFileSync(join(root0, 'bare.ts'), 'export const bare = 1;');
    writeFileSync(join(root0, 'some-dir', 'index.ts'), 'export default 42;');

    const vfs = buildVfs(
      parseRuntimeManifest(
        JSON.stringify({
          ContentRoots: [`${root0}${sep}`],
          Root: {
            Children: null,
            Asset: null,
            Patterns: [{ ContentRootIndex: 0, Pattern: '**', Depth: 0 }],
          },
        }),
      ),
    );
    r = new AssetResolver(vfs, new Map());
  });

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('extensionless bare specifier resolves via .ts probe', () => {
    expect(r.resolve('bare')).toBe(join(root0, 'bare.ts'));
  });

  it('bare directory specifier resolves via index.ts probe', () => {
    expect(r.resolve('some-dir')).toBe(join(root0, 'some-dir', 'index.ts'));
  });
});
