import { describe, it, expect } from 'vitest';
import type { AssetResolver } from '../asset-resolution/asset-resolver';
import { FileDiscoverer, type DiscoveryGroup, type DiscoveryEntry } from './file-discoverer';

function createResolver(
  routes: string[],
  resolveMap: Record<string, string | null>,
): AssetResolver {
  return {
    routes: () => routes[Symbol.iterator](),
    resolve: (route: string) => (route in resolveMap ? resolveMap[route] : null),
  } as unknown as AssetResolver;
}

function group(groups: DiscoveryGroup[], name: string): DiscoveryGroup {
  const g = groups.find((x) => x.packageName === name);
  if (!g) throw new Error(`no group "${name}" in [${groups.map((x) => x.packageName).join(', ')}]`);
  return g;
}

function entry(g: DiscoveryGroup, canonical: string): DiscoveryEntry {
  const e = g.entries.find((x) => x.canonical === canonical);
  if (!e) throw new Error(`no entry canonical "${canonical}"`);
  return e;
}

describe('FileDiscoverer', () => {
  it('single .ts route emits a suffixed package and a bare package (ts compiled)', () => {
    const resolver = createResolver(['pkg.ts'], { 'pkg.ts': '/src/pkg.ts' });
    const groups = new FileDiscoverer(resolver).discover();

    const bare = group(groups, 'pkg');
    expect(bare.entries).toHaveLength(1);
    expect(bare.entries[0]!.canonical).toBe('');
    expect(bare.entries[0]!.aliases).toEqual([]);
    expect(bare.entries[0]!.sourceFile).toBe('/src/pkg.ts');

    const suffixed = group(groups, 'pkg.ts');
    expect(suffixed.entries[0]!.canonical).toBe('');
    expect(suffixed.entries[0]!.aliases).toEqual([]);
    expect(suffixed.entries[0]!.sourceFile).toBe('/src/pkg.ts');
  });

  it('single .d.ts route emits only a bare entry that forwards the definition', () => {
    const resolver = createResolver(['pkg.d.ts'], { 'pkg.d.ts': '/src/pkg.d.ts' });
    const groups = new FileDiscoverer(resolver).discover();

    expect(groups.map((g) => g.packageName)).toEqual(['pkg']);
    const e = group(groups, 'pkg').entries[0]!;
    expect(e.canonical).toBe('');
    expect(e.aliases).toEqual([]);
    expect(e.definitionFile).toBe('/src/pkg.d.ts');
    expect(e.sourceFile).toBeUndefined();
  });

  it('.ts + .d.ts nested base: suffixed + bare share one entry forwarding the .d.ts', () => {
    const resolver = createResolver(['pkg/foo.ts', 'pkg/foo.d.ts'], {
      'pkg/foo.ts': '/src/foo.ts',
      'pkg/foo.d.ts': '/src/foo.d.ts',
    });
    const groups = new FileDiscoverer(resolver).discover();

    const g = group(groups, 'pkg');
    expect(g.entries).toHaveLength(1);
    const e = g.entries[0]!;
    expect(e.canonical).toBe('foo');
    expect(e.aliases).toEqual(['foo.ts']);
    expect(e.definitionFile).toBe('/src/foo.d.ts');
    expect(e.sourceFile).toBeUndefined();
  });

  it('.js + .d.ts: suffixed + bare share one entry forwarding the .d.ts (real types win)', () => {
    const resolver = createResolver(['_framework/dotnet.js', '_framework/dotnet.d.ts'], {
      '_framework/dotnet.js': '/dist/_framework/dotnet.js',
      '_framework/dotnet.d.ts': '/dist/_framework/dotnet.d.ts',
    });
    const groups = new FileDiscoverer(resolver).discover();

    const g = group(groups, '_framework');
    expect(g.entries).toHaveLength(1);
    const e = g.entries[0]!;
    expect(e.canonical).toBe('dotnet');
    expect(e.aliases).toEqual(['dotnet.js']);
    expect(e.definitionFile).toBe('/dist/_framework/dotnet.d.ts');
    expect(e.sourceFile).toBeUndefined();
  });

  it('type-less .js: suffixed + bare share one compiled entry, bare canonical', () => {
    const resolver = createResolver(['_framework/blazor.webassembly.js'], {
      '_framework/blazor.webassembly.js': '/dist/_framework/blazor.webassembly.js',
    });
    const groups = new FileDiscoverer(resolver).discover();

    const g = group(groups, '_framework');
    expect(g.entries).toHaveLength(1);
    const e = g.entries[0]!;
    expect(e.canonical).toBe('blazor.webassembly');
    expect(e.aliases).toEqual(['blazor.webassembly.js']);
    expect(e.sourceFile).toBe('/dist/_framework/blazor.webassembly.js');
    expect(e.definitionFile).toBeUndefined();
  });

  it('.js + .ts (no .d.ts): two entries; bare joins the .ts unit (authored wins)', () => {
    const resolver = createResolver(['pkg/mod.js', 'pkg/mod.ts'], {
      'pkg/mod.js': '/src/mod.js',
      'pkg/mod.ts': '/src/mod.ts',
    });
    const groups = new FileDiscoverer(resolver).discover();

    const g = group(groups, 'pkg');
    expect(g.entries).toHaveLength(2);

    const js = entry(g, 'mod.js');
    expect(js.aliases).toEqual([]);
    expect(js.sourceFile).toBe('/src/mod.js');

    const ts = entry(g, 'mod');
    expect(ts.aliases).toEqual(['mod.ts']);
    expect(ts.sourceFile).toBe('/src/mod.ts');
  });

  it('.js + .ts + .d.ts: all three specifiers forward the single .d.ts', () => {
    const resolver = createResolver(['pkg/mod.js', 'pkg/mod.ts', 'pkg/mod.d.ts'], {
      'pkg/mod.js': '/src/mod.js',
      'pkg/mod.ts': '/src/mod.ts',
      'pkg/mod.d.ts': '/src/mod.d.ts',
    });
    const groups = new FileDiscoverer(resolver).discover();

    const g = group(groups, 'pkg');
    expect(g.entries).toHaveLength(1);
    const e = g.entries[0]!;
    expect(e.canonical).toBe('mod');
    expect(e.aliases).toEqual(['mod.js', 'mod.ts']);
    expect(e.definitionFile).toBe('/src/mod.d.ts');
  });

  it('nested route extracts packageName (first segment) and keeps deep subpaths', () => {
    const resolver = createResolver(['pkg/a/b/c.ts'], { 'pkg/a/b/c.ts': '/src/pkg/a/b/c.ts' });
    const groups = new FileDiscoverer(resolver).discover();

    const g = group(groups, 'pkg');
    const e = entry(g, 'a/b/c');
    expect(e.aliases).toEqual(['a/b/c.ts']);
    expect(e.sourceFile).toBe('/src/pkg/a/b/c.ts');
  });

  it('multiple subpaths in one package produce multiple entries', () => {
    const resolver = createResolver(['pkg/mod1.d.ts', 'pkg/mod2.d.ts'], {
      'pkg/mod1.d.ts': '/src/mod1.d.ts',
      'pkg/mod2.d.ts': '/src/mod2.d.ts',
    });
    const groups = new FileDiscoverer(resolver).discover();

    const g = group(groups, 'pkg');
    expect(g.entries).toHaveLength(2);
    expect(entry(g, 'mod1').definitionFile).toBe('/src/mod1.d.ts');
    expect(entry(g, 'mod2').definitionFile).toBe('/src/mod2.d.ts');
  });

  it('multiple packages produce multiple groups', () => {
    const resolver = createResolver(['pkg1.d.ts', 'pkg2.d.ts'], {
      'pkg1.d.ts': '/src/pkg1.d.ts',
      'pkg2.d.ts': '/src/pkg2.d.ts',
    });
    const groups = new FileDiscoverer(resolver).discover();

    expect(groups.map((g) => g.packageName)).toEqual(['pkg1', 'pkg2']);
  });

  it('non-compilable routes (.css, .wasm, .mjs) are skipped', () => {
    const resolver = createResolver(['app.css', 'mod.wasm', 'util.mjs'], {
      'app.css': '/src/app.css',
      'mod.wasm': '/src/mod.wasm',
      'util.mjs': '/src/util.mjs',
    });
    const groups = new FileDiscoverer(resolver).discover();

    expect(groups).toHaveLength(0);
  });

  it('routes resolving to null are excluded', () => {
    const resolver = createResolver(['typeshim.d.ts', 'orphan.d.ts'], {
      'typeshim.d.ts': '/src/typeshim.d.ts',
      'orphan.d.ts': null,
    });
    const groups = new FileDiscoverer(resolver).discover();

    expect(groups.map((g) => g.packageName)).toEqual(['typeshim']);
  });

  it('root-level .js + .ts emit three packages; bare owned by the .ts source', () => {
    const resolver = createResolver(['typeshim.js', 'typeshim.ts'], {
      'typeshim.js': '/dist/typeshim.js',
      'typeshim.ts': '/dist/typeshim.ts',
    });
    const groups = new FileDiscoverer(resolver).discover();

    expect(groups.map((g) => g.packageName).sort()).toEqual([
      'typeshim',
      'typeshim.js',
      'typeshim.ts',
    ]);
    expect(group(groups, 'typeshim.js').entries[0]!.sourceFile).toBe('/dist/typeshim.js');
    expect(group(groups, 'typeshim.ts').entries[0]!.sourceFile).toBe('/dist/typeshim.ts');
    expect(group(groups, 'typeshim').entries[0]!.sourceFile).toBe('/dist/typeshim.ts');
  });
});
