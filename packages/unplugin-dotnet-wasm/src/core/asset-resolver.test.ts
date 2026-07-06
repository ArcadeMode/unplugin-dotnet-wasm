import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AssetResolver } from './asset-resolver.js';
import { buildVfs, type VirtualFileSystem, type ResolvedAsset } from './vfs.js';
import { buildEndpointLookup } from './endpoint-lookup.js';
import type { EndpointLookup, EndpointMatch } from './endpoint-lookup.js';
import { parseRuntimeManifest } from './manifest-runtime.js';
import { parseEndpointsManifest } from './manifest-endpoints.js';

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

describe('AssetResolver input normalisation', () => {
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

describe('AssetResolver probe expansion', () => {
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

describe('AssetResolver endpoint alias paths', () => {
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

describe('AssetResolver full miss', () => {
  it('returns null when both VFS and endpoint lookup miss for every probe', () => {
    expect(new AssetResolver(stubVfs(), new Map()).resolve('nonexistent.wasm')).toBeNull();
  });
});

const SAMPLE_ROOT = resolve(__dirname, '../../../samples/SampleLibrary');
const RUNTIME_MANIFEST = resolve(SAMPLE_ROOT, 'bin/Debug/net10.0/SampleLibrary.staticwebassets.runtime.json');
const ENDPOINTS_MANIFEST = resolve(SAMPLE_ROOT, 'bin/Debug/net10.0/SampleLibrary.staticwebassets.endpoints.json');

describe('AssetResolver real fixture', () => {
  let r: AssetResolver;

  beforeAll(() => {
    const vfs = buildVfs(parseRuntimeManifest(readFileSync(RUNTIME_MANIFEST)));
    const endpoints = buildEndpointLookup(parseEndpointsManifest(readFileSync(ENDPOINTS_MANIFEST)));
    r = new AssetResolver(vfs, endpoints);
  });

  it('resolves extensionless typeshim to a path ending in typeshim.ts', () => {
    const result = r.resolve('typeshim');
    expect(result).not.toBeNull();
    expect(result).toMatch(/typeshim\.ts$/);
  });
});

const TEMP_DIR = resolve(__dirname, '../../.test-tmp/ar-probe');

describe('AssetResolver probing through pattern fallthrough', () => {
  let root0: string;
  let r: AssetResolver;

  beforeAll(() => {
    root0 = join(TEMP_DIR, 'root0');
    rmSync(TEMP_DIR, { recursive: true, force: true });
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
    rmSync(TEMP_DIR, { recursive: true, force: true });
  });

  it('extensionless bare specifier resolves via .ts probe', () => {
    expect(r.resolve('bare')).toBe(join(root0, 'bare.ts'));
  });

  it('bare directory specifier resolves via index.ts probe', () => {
    expect(r.resolve('some-dir')).toBe(join(root0, 'some-dir', 'index.ts'));
  });
});
