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
    const resolver = createResolver(
      ['pkg/foo.ts', 'pkg/foo.d.ts'],
      { 'pkg/foo.ts': '/src/foo.ts', 'pkg/foo.d.ts': '/src/foo.d.ts' },
    );
    const discoverer = new FileDiscoverer(resolver);

    const groups = discoverer.discover();

    expect(groups).toHaveLength(1);
    const group = groups[0]!;
    expect(group.entries).toHaveLength(1);
    expect(group.entries[0]!.sourceFile).toBe('/src/foo.ts');
    expect(group.entries[0]!.definitionFile).toBe('/src/foo.d.ts');
  });

  it('foo.d.ts + foo.ts produces one entry with both slots filled (definition checked first)', () => {
    const resolver = createResolver(
      ['pkg/foo.d.ts', 'pkg/foo.ts'],
      { 'pkg/foo.d.ts': '/src/foo.d.ts', 'pkg/foo.ts': '/src/foo.ts' },
    );
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
    const resolver = createResolver(
      ['pkg/mod1.ts', 'pkg/mod2.ts'],
      { 'pkg/mod1.ts': '/src/mod1.ts', 'pkg/mod2.ts': '/src/mod2.ts' },
    );
    const discoverer = new FileDiscoverer(resolver);

    const groups = discoverer.discover();

    expect(groups).toHaveLength(1);
    const group = groups[0]!;
    expect(group.entries).toHaveLength(2);
    expect(group.entries[0]!.subpath).toBe('mod1');
    expect(group.entries[1]!.subpath).toBe('mod2');
  });

  it('multiple packages produce multiple groups in first-seen order', () => {
    const resolver = createResolver(
      ['pkg1.ts', 'pkg2.ts'],
      { 'pkg1.ts': '/src/pkg1.ts', 'pkg2.ts': '/src/pkg2.ts' },
    );
    const discoverer = new FileDiscoverer(resolver);

    const groups = discoverer.discover();

    expect(groups).toHaveLength(2);
    expect(groups[0]!.packageName).toBe('pkg1');
    expect(groups[1]!.packageName).toBe('pkg2');
  });

  it('non-TS routes (.css, .wasm, .js, .mjs) are skipped', () => {
    const resolver = createResolver(
      ['app.css', 'mod.wasm', 'index.js', 'util.mjs'],
      {
        'app.css': '/src/app.css',
        'mod.wasm': '/src/mod.wasm',
        'index.js': '/src/index.js',
        'util.mjs': '/src/util.mjs',
      },
    );
    const discoverer = new FileDiscoverer(resolver);

    const groups = discoverer.discover();

    expect(groups).toHaveLength(0);
  });

  it('route resolving to null is excluded', () => {
    const resolver = createResolver(
      ['typeshim.ts', 'orphan.ts'],
      { 'typeshim.ts': '/src/typeshim.ts', 'orphan.ts': null },
    );
    const discoverer = new FileDiscoverer(resolver);

    const groups = discoverer.discover();

    expect(groups).toHaveLength(1);
    expect(groups[0]!.packageName).toBe('typeshim');
  });

});
