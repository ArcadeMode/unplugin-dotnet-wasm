import {  describe, expect, it, vi } from 'vitest';
import { AssetResolver } from './asset-resolver';
import { type VirtualFileSystem, type ResolvedAsset } from './vfs';
import { EndpointLookup, type EndpointMatch } from './endpoint-lookup';
import { normalizePath } from '../path-utils';

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

function lookupOf(...entries: Array<[string, EndpointMatch]>): EndpointLookup {
  const lookup = new EndpointLookup();
  for (const [route, match] of entries) lookup.set(normalizePath(route), match);
  return lookup;
}

describe('AssetResolver input normalisation', () => {
  it('returns null for an empty string', () => {
    expect(new AssetResolver(stubVfs(), new EndpointLookup()).resolve('')).toBeNull();
  });

  it('returns null for "./" (nothing after strip)', () => {
    expect(new AssetResolver(stubVfs(), new EndpointLookup()).resolve('./')).toBeNull();
  });

  it('returns null for "/" (nothing after strip)', () => {
    expect(new AssetResolver(stubVfs(), new EndpointLookup()).resolve('/')).toBeNull();
  });

  it('strips leading "./" before delegating to vfs.resolve', () => {
    const resolveFn = vi.fn().mockReturnValue(undefined);
    new AssetResolver(stubVfs({ resolve: resolveFn }), new EndpointLookup()).resolve('./foo.ts');
    expect(resolveFn).toHaveBeenCalledWith('foo.ts');
    expect(resolveFn).not.toHaveBeenCalledWith('./foo.ts');
  });

  it('strips leading "/" before delegating to vfs.resolve', () => {
    const resolveFn = vi.fn().mockReturnValue(undefined);
    new AssetResolver(stubVfs({ resolve: resolveFn }), new EndpointLookup()).resolve('/foo.ts');
    expect(resolveFn).toHaveBeenCalledWith('foo.ts');
    expect(resolveFn).not.toHaveBeenCalledWith('/foo.ts');
  });
});

describe('AssetResolver probe expansion', () => {
  it('does not expand probes when the source already has a file extension', () => {
    const resolveFn = vi.fn().mockReturnValue(undefined);
    new AssetResolver(stubVfs({ resolve: resolveFn }), new EndpointLookup()).resolve('foo.js');
    expect(resolveFn).toHaveBeenCalledTimes(1);
    expect(resolveFn).toHaveBeenCalledWith('foo.js');
  });

  it('returns the index.<ext> hit when no extension probe matches', () => {
    const resolveFn = vi.fn().mockImplementation((vp: string) =>
      vp === 'some-dir/index.ts' ? vfsAsset('/abs/some-dir/index.ts') : undefined,
    );
    const r = new AssetResolver(stubVfs({ resolve: resolveFn }), new EndpointLookup());
    expect(r.resolve('some-dir')).toBe('/abs/some-dir/index.ts');
  });

  it('stops at the first VFS hit and returns its physicalPath', () => {
    const resolveFn = vi.fn().mockImplementation((vp: string) =>
      vp === 'bare.ts' ? vfsAsset('/abs/bare.ts') : undefined,
    );
    const r = new AssetResolver(stubVfs({ resolve: resolveFn }), new EndpointLookup());
    expect(r.resolve('bare')).toBe('/abs/bare.ts');
    // 'bare' (miss) + 'bare.ts' (hit) = exactly 2 calls; no further probing
    expect(resolveFn).toHaveBeenCalledTimes(2);
  });
});

describe('AssetResolver endpoint alias paths', () => {
  const fpMatch: EndpointMatch = { assetFile: '_framework/dotnet.abc123.js', responseHeaders: [] };
  const lookup: EndpointLookup = lookupOf(['_framework/dotnet.js', fpMatch]);

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
    const lookupWithSpy = lookupOf(['foo.ts', fpMatch]);
    const getSpy = vi.spyOn(lookupWithSpy, 'get');
    const r = new AssetResolver(stubVfs({ resolve: resolveFn }), lookupWithSpy);
    expect(r.resolve('foo.ts')).toBe('/abs/foo.ts');
    expect(getSpy).not.toHaveBeenCalled();
  });
});

describe('AssetResolver relative specifier clamping', () => {
  it('collapses the bundler-friendly `./../_content/…` initializer specifier to its canonical route', () => {
    // dotnet.js (virtually at _framework/) statically imports the initializer as
    // `./../_content/<pkg>/<pkg>.lib.module.js`; it must resolve to `_content/…`.
    const resolveFn = vi.fn().mockImplementation((vp: string) =>
      vp === '_content/Pkg/Pkg.lib.module.js'
        ? vfsAsset('/nuget/pkg/staticwebassets/Pkg.lib.module.js')
        : undefined,
    );
    const r = new AssetResolver(stubVfs({ resolve: resolveFn }), new EndpointLookup());
    expect(r.resolve('./../_content/Pkg/Pkg.lib.module.js')).toBe(
      '/nuget/pkg/staticwebassets/Pkg.lib.module.js',
    );
    expect(resolveFn).toHaveBeenCalledWith('_content/Pkg/Pkg.lib.module.js');
  });

  it('clamps `..` segments that would escape above the root', () => {
    const resolveFn = vi.fn().mockReturnValue(undefined);
    new AssetResolver(stubVfs({ resolve: resolveFn }), new EndpointLookup()).resolve('../../foo.js');
    expect(resolveFn).toHaveBeenCalledWith('foo.js');
  });

  it('collapses interior `.`/`..` segments', () => {
    const resolveFn = vi.fn().mockReturnValue(undefined);
    new AssetResolver(stubVfs({ resolve: resolveFn }), new EndpointLookup()).resolve('_framework/./sub/../dotnet.js');
    expect(resolveFn).toHaveBeenCalledWith('_framework/dotnet.js');
  });
});

describe('AssetResolver full miss', () => {
  it('returns null when both VFS and endpoint lookup miss for every probe', () => {
    expect(new AssetResolver(stubVfs(), new EndpointLookup()).resolve('nonexistent.wasm')).toBeNull();
  });
});

describe('AssetResolver case-insensitive endpoint lookup', () => {
  it('resolves and retrieves headers with mixed-case specifier against lowercase manifest route', () => {
    const fpMatch: EndpointMatch = { assetFile: '_framework/dotnet.abc123.js', responseHeaders: [{ Name: 'Content-Type', Value: 'text/javascript' }] };
    const lookup: EndpointLookup = lookupOf(['_framework/dotnet.js', fpMatch]);
    const resolveFn = vi.fn().mockImplementation((vp: string) =>
      vp === '_framework/dotnet.abc123.js'
        ? vfsAsset('/abs/_framework/dotnet.abc123.js')
        : undefined,
    );
    const r = new AssetResolver(stubVfs({ resolve: resolveFn }), lookup);
    // Query with mixed case
    expect(r.resolve('/_Framework/Dotnet.JS')).toBe('/abs/_framework/dotnet.abc123.js');
    // Headers should also be found with mixed case
    expect(r.headersFor('/_Framework/Dotnet.JS')).toEqual([{ Name: 'Content-Type', Value: 'text/javascript' }]);
  });

  it('resolves and retrieves headers for non-canonical path with dot segments', () => {
    const fpMatch: EndpointMatch = { assetFile: '_framework/dotnet.abc123.js', responseHeaders: [{ Name: 'Content-Type', Value: 'text/javascript' }] };
    const lookup: EndpointLookup = lookupOf(['_framework/dotnet.js', fpMatch]);
    const resolveFn = vi.fn().mockImplementation((vp: string) =>
      vp === '_framework/dotnet.abc123.js'
        ? vfsAsset('/abs/_framework/dotnet.abc123.js')
        : undefined,
    );
    const r = new AssetResolver(stubVfs({ resolve: resolveFn }), lookup);
    // Query with ./ segments
    expect(r.resolve('/_framework/./dotnet.js')).toBe('/abs/_framework/dotnet.abc123.js');
    // Headers should also be found
    expect(r.headersFor('/_framework/./dotnet.js')).toEqual([{ Name: 'Content-Type', Value: 'text/javascript' }]);
  });
});
