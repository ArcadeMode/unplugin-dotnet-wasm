import { describe, it, expect } from 'vitest';
import type { AssetResolver } from '../asset-resolution/asset-resolver';
import { FileDiscoverer } from './file-discoverer';

function createResolver(
  routes: string[],
  resolveMap: Record<string, string | null>,
): AssetResolver {
  return {
    routes: () => routes[Symbol.iterator](),
    resolve: (route: string) => (route in resolveMap ? resolveMap[route] : null),
  } as unknown as AssetResolver;
}

describe('FileDiscoverer', () => {
  it('single .ts route produces one group with one entry (sourceFile set)', () => {
    const resolver = createResolver(['pkg.ts'], { 'pkg.ts': '/src/pkg.ts' });
    const discoverer = new FileDiscoverer(resolver);

    const groups = discoverer.discover();

    expect(groups).toHaveLength(1);
    const group = groups[0]!;
    expect(group.packageName).toBe('pkg');
    expect(group.entries).toHaveLength(1);
    expect(group.entries[0]!.subpath).toBe('');
    expect(group.entries[0]!.sourceFile).toBe('/src/pkg.ts');
    expect(group.entries[0]!.definitionFile).toBeUndefined();
  });

  it('single .d.ts route produces entry with definitionFile set', () => {
    const resolver = createResolver(['pkg.d.ts'], { 'pkg.d.ts': '/src/pkg.d.ts' });
    const discoverer = new FileDiscoverer(resolver);

    const groups = discoverer.discover();

    expect(groups).toHaveLength(1);
    const entry = groups[0]!.entries[0]!;
    expect(entry.definitionFile).toBe('/src/pkg.d.ts');
    expect(entry.sourceFile).toBeUndefined();
  });

  it('foo.ts + foo.d.ts in insertion order produces one entry with both slots filled', () => {
    const resolver = createResolver(['pkg/foo.ts', 'pkg/foo.d.ts'], {
      'pkg/foo.ts': '/src/foo.ts',
      'pkg/foo.d.ts': '/src/foo.d.ts',
    });
    const discoverer = new FileDiscoverer(resolver);

    const groups = discoverer.discover();

    expect(groups).toHaveLength(1);
    const group = groups[0]!;
    expect(group.entries).toHaveLength(1);
    expect(group.entries[0]!.sourceFile).toBe('/src/foo.ts');
    expect(group.entries[0]!.definitionFile).toBe('/src/foo.d.ts');
  });

  it('foo.d.ts + foo.ts produces one entry with both slots filled (definition checked first)', () => {
    const resolver = createResolver(['pkg/foo.d.ts', 'pkg/foo.ts'], {
      'pkg/foo.d.ts': '/src/foo.d.ts',
      'pkg/foo.ts': '/src/foo.ts',
    });
    const discoverer = new FileDiscoverer(resolver);

    const groups = discoverer.discover();

    const group = groups[0]!;
    expect(group.entries).toHaveLength(1);
    expect(group.entries[0]!.sourceFile).toBe('/src/foo.ts');
    expect(group.entries[0]!.definitionFile).toBe('/src/foo.d.ts');
  });

  it('nested route (pkg/a/b/c.ts) extracts correct packageName and subpath', () => {
    const resolver = createResolver(['pkg/a/b/c.ts'], { 'pkg/a/b/c.ts': '/src/pkg/a/b/c.ts' });
    const discoverer = new FileDiscoverer(resolver);

    const groups = discoverer.discover();

    const group = groups[0]!;
    expect(group.packageName).toBe('pkg');
    expect(group.entries[0]!.subpath).toBe('a/b/c');
  });

  it('multiple subpaths in one package produce one group with multiple entries', () => {
    const resolver = createResolver(['pkg/mod1.ts', 'pkg/mod2.ts'], {
      'pkg/mod1.ts': '/src/mod1.ts',
      'pkg/mod2.ts': '/src/mod2.ts',
    });
    const discoverer = new FileDiscoverer(resolver);

    const groups = discoverer.discover();

    expect(groups).toHaveLength(1);
    const group = groups[0]!;
    expect(group.entries).toHaveLength(2);
    expect(group.entries[0]!.subpath).toBe('mod1');
    expect(group.entries[1]!.subpath).toBe('mod2');
  });

  it('multiple packages produce multiple groups in first-seen order', () => {
    const resolver = createResolver(['pkg1.ts', 'pkg2.ts'], {
      'pkg1.ts': '/src/pkg1.ts',
      'pkg2.ts': '/src/pkg2.ts',
    });
    const discoverer = new FileDiscoverer(resolver);

    const groups = discoverer.discover();

    expect(groups).toHaveLength(2);
    expect(groups[0]!.packageName).toBe('pkg1');
    expect(groups[1]!.packageName).toBe('pkg2');
  });

  it('non-compilable routes (.css, .wasm, .mjs) are skipped', () => {
    const resolver = createResolver(['app.css', 'mod.wasm', 'util.mjs'], {
      'app.css': '/src/app.css',
      'mod.wasm': '/src/mod.wasm',
      'util.mjs': '/src/util.mjs',
    });
    const discoverer = new FileDiscoverer(resolver);

    const groups = discoverer.discover();

    expect(groups).toHaveLength(0);
  });

  it('type-less .js route becomes a sourceFile entry that keeps its extension', () => {
    const resolver = createResolver(['_framework/blazor.webassembly.js'], {
      '_framework/blazor.webassembly.js': '/dist/_framework/blazor.webassembly.js',
    });
    const discoverer = new FileDiscoverer(resolver);

    const groups = discoverer.discover();

    expect(groups).toHaveLength(1);
    const group = groups[0]!;
    expect(group.packageName).toBe('_framework');
    expect(group.entries).toHaveLength(1);
    const entry = group.entries[0]!;
    // Imported WITH the extension, so the subpath keeps `.js`.
    expect(entry.subpath).toBe('blazor.webassembly.js');
    expect(entry.sourceFile).toBe('/dist/_framework/blazor.webassembly.js');
    expect(entry.definitionFile).toBeUndefined();
  });

  it('root-level .js route uses the file name (with extension) as the package', () => {
    const resolver = createResolver(['boot.js'], { 'boot.js': '/dist/boot.js' });
    const discoverer = new FileDiscoverer(resolver);

    const group = discoverer.discover()[0]!;
    expect(group.packageName).toBe('boot.js');
    expect(group.entries[0]!.subpath).toBe('');
    expect(group.entries[0]!.sourceFile).toBe('/dist/boot.js');
  });

  it('.js route is skipped when a .d.ts sibling covers the same specifier', () => {
    const resolver = createResolver(['_framework/dotnet.js', '_framework/dotnet.d.ts'], {
      '_framework/dotnet.js': '/dist/_framework/dotnet.js',
      '_framework/dotnet.d.ts': '/dist/_framework/dotnet.d.ts',
    });
    const discoverer = new FileDiscoverer(resolver);

    const groups = discoverer.discover();

    expect(groups).toHaveLength(1);
    const group = groups[0]!;
    // Only the definition-backed entry survives; no redundant `dotnet.js` shim.
    expect(group.entries).toHaveLength(1);
    expect(group.entries[0]!.subpath).toBe('dotnet');
    expect(group.entries[0]!.definitionFile).toBe('/dist/_framework/dotnet.d.ts');
  });

  it('.js dedup ignores route order (.js seen before its .d.ts sibling)', () => {
    const resolver = createResolver(['pkg/mod.js', 'pkg/mod.d.ts'], {
      'pkg/mod.js': '/dist/mod.js',
      'pkg/mod.d.ts': '/dist/mod.d.ts',
    });
    const discoverer = new FileDiscoverer(resolver);

    const group = discoverer.discover()[0]!;
    expect(group.entries).toHaveLength(1);
    expect(group.entries[0]!.subpath).toBe('mod');
    expect(group.entries[0]!.definitionFile).toBe('/dist/mod.d.ts');
  });

  it('a type-less .js is shimmed alongside a typed sibling in the same package', () => {
    const resolver = createResolver(
      ['_framework/dotnet.d.ts', '_framework/blazor.webassembly.js'],
      {
        '_framework/dotnet.d.ts': '/dist/_framework/dotnet.d.ts',
        '_framework/blazor.webassembly.js': '/dist/_framework/blazor.webassembly.js',
      },
    );
    const discoverer = new FileDiscoverer(resolver);

    const group = discoverer.discover()[0]!;
    expect(group.packageName).toBe('_framework');
    expect(group.entries).toHaveLength(2);
    const dotnet = group.entries.find((e) => e.subpath === 'dotnet')!;
    const blazor = group.entries.find((e) => e.subpath === 'blazor.webassembly.js')!;
    expect(dotnet.definitionFile).toBe('/dist/_framework/dotnet.d.ts');
    expect(blazor.sourceFile).toBe('/dist/_framework/blazor.webassembly.js');
  });

  it('route resolving to null is excluded', () => {
    const resolver = createResolver(['typeshim.ts', 'orphan.ts'], {
      'typeshim.ts': '/src/typeshim.ts',
      'orphan.ts': null,
    });
    const discoverer = new FileDiscoverer(resolver);

    const groups = discoverer.discover();

    expect(groups).toHaveLength(1);
    expect(groups[0]!.packageName).toBe('typeshim');
  });
});
