import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseRuntimeManifest } from './manifest-runtime.js';
import { buildVfs, type VirtualFileSystem } from './vfs.js';

// ---------------------------------------------------------------------------
// Real fixture paths
// ---------------------------------------------------------------------------

const LIBRARY_ROOT = resolve(__dirname, '../../../../test/fixtures/Library');
const MANIFEST_PATH = resolve(
  LIBRARY_ROOT,
  'bin/Debug/net10.0/Library.staticwebassets.runtime.json',
);
// Physical roots — join() handles the trailing separator.
const ROOT0 = resolve(LIBRARY_ROOT, 'wwwroot');                                        // source (ContentRoot 0)
const ROOT_OBJ1 = resolve(LIBRARY_ROOT, 'obj', 'Debug', 'net10.0', 'TypeShim', 'staticwebassets', 'wwwroot'); // TypeShim generated (ContentRoot 1)
const ROOT2 = resolve(LIBRARY_ROOT, 'bin', 'Debug', 'net10.0', 'wwwroot');             // build output (ContentRoot 2)

// ---------------------------------------------------------------------------
// Real fixture — core resolution scenarios
// ---------------------------------------------------------------------------

describe('buildVfs — real fixture', () => {
  let vfs: VirtualFileSystem;

  beforeAll(() => {
    vfs = buildVfs(parseRuntimeManifest(readFileSync(MANIFEST_PATH)));
  });

  // ── contentRoots ──────────────────────────────────────────────────────────

  it('contentRoots are POSIX with trailing slash', () => {
    expect(vfs.contentRoots).toHaveLength(3);
    for (const r of vfs.contentRoots) {
      expect(r, 'must not contain backslashes').not.toContain('\\');
      expect(r.at(-1), 'must end with /').toBe('/');
    }
  });

  // ── manifest-explicit assets (cross-root resolution) ──────────────────────

  it('resolve fingerprinted dotnet.*.js → root 2 (build output)', () => {
    // With WasmFingerprintAssets=true the VFS enumerates fingerprinted names;
    // canonical `dotnet.js` is absent.  Discover the actual key from the listing.
    const fpPath = vfs.list('_framework').find(p => /\/dotnet\.[a-z0-9]+\.js$/.test(p));
    expect(fpPath, 'expected a fingerprinted dotnet.*.js in the VFS listing').toBeDefined();
    const asset = vfs.resolve(fpPath!);
    expect(asset).toBeDefined();
    expect(asset!.physicalPath).toContain(join(ROOT2, '_framework'));
    expect(asset!.physicalPath).toMatch(/dotnet\.[a-z0-9]+\.js$/);
    expect(asset!.contentRootIndex).toBe(2);
  });

  it('resolve _framework/dotnet.d.ts → root 0 (source root)', () => {
    const asset = vfs.resolve('_framework/dotnet.d.ts');
    expect(asset).toBeDefined();
    expect(asset!.physicalPath).toBe(join(ROOT0, '_framework', 'dotnet.d.ts'));
    expect(asset!.contentRootIndex).toBe(0);
  });

  // ── extension probing against the enumerated map ──────────────────────────

  it('resolve wasm-bootstrap (extensionless) → wasm-bootstrap.ts in root 0', () => {
    const asset = vfs.resolve('wasm-bootstrap');
    expect(asset).toBeDefined();
    expect(asset!.physicalPath).toBe(join(ROOT0, 'wasm-bootstrap.ts'));
    expect(asset!.contentRootIndex).toBe(0);
  });

  it('resolve main (extensionless) → main.ts in root 0', () => {
    const asset = vfs.resolve('main');
    expect(asset).toBeDefined();
    expect(asset!.physicalPath).toBe(join(ROOT0, 'main.ts'));
    expect(asset!.contentRootIndex).toBe(0);
  });

  // ── list() ────────────────────────────────────────────────────────────────

  it('list _framework returns direct children with full virtual paths', () => {
    // With WasmFingerprintAssets=true the manifest enumerates fingerprinted names.
    const children = vfs.list('_framework');
    expect(children.some(c => /^_framework\/dotnet\.[a-z0-9]+\.js$/.test(c))).toBe(true);
    expect(children).toContain('_framework/dotnet.d.ts');
    expect(children.some(c => /^_framework\/Library\.[a-z0-9]+\.wasm$/.test(c))).toBe(true);
    // Each entry must be exactly two segments deep.
    for (const c of children) {
      expect(c.split('/'), `"${c}" should have exactly 2 segments`).toHaveLength(2);
    }
  });

  it('list returns sorted results', () => {
    const children = vfs.list('_framework');
    const sorted = [...children].sort();
    expect(children).toEqual(sorted);
  });

  // ── miss behaviour ────────────────────────────────────────────────────────

  it('returns undefined for a path that does not exist', () => {
    expect(vfs.resolve('does-not-exist.ts')).toBeUndefined();
    expect(vfs.resolve('_framework/nonexistent.wasm')).toBeUndefined();
  });

  it('resolve typeshim (extensionless) → typeshim.ts in root 1 (TypeShim obj dir)', () => {
    // typeshim.ts is explicitly enumerated in the manifest at ContentRootIndex 1
    // (the generated obj/Debug/net10.0/TypeShim/staticwebassets/wwwroot/ directory).
    const asset = vfs.resolve('typeshim');
    expect(asset).toBeDefined();
    expect(asset!.physicalPath).toBe(join(ROOT_OBJ1, 'typeshim.ts'));
    expect(asset!.contentRootIndex).toBe(1);
  });

  // ── performance ───────────────────────────────────────────────────────────

  it('10 000 hot lookups complete in under 50 ms', () => {
    // Use dotnet.d.ts (root 0, canonical, never fingerprinted) for a reliable hit,
    // and the discovered fingerprinted JS path for a root-2 hit.
    const fpPath = vfs.list('_framework').find(p => /\/dotnet\.[a-z0-9]+\.js$/.test(p)) ?? '_framework/dotnet.d.ts';
    const start = performance.now();
    for (let i = 0; i < 10_000; i++) {
      vfs.resolve(fpPath);
      vfs.resolve('_framework/dotnet.d.ts');
    }
    expect(performance.now() - start).toBeLessThan(50);
  });
});

// ---------------------------------------------------------------------------
// Synthetic: pattern fallthrough (lazy disk hits via Patterns rule)
// ---------------------------------------------------------------------------

describe('buildVfs — synthetic: pattern fallthrough', () => {
  let tmpRoot: string;
  let root0: string;
  let vfs: VirtualFileSystem;

  beforeAll(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'vfs-pat-'));
    root0 = join(tmpRoot, 'root0');
    mkdirSync(root0, { recursive: true });
    writeFileSync(join(root0, 'unlisted.css'), 'body {}');

    // Manifest with no explicit Asset entries — only the `**` fallthrough rule.
    vfs = buildVfs(
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
  });

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('finds a file on disk under the patterned content root via stat', () => {
    const asset = vfs.resolve('unlisted.css');
    expect(asset).toBeDefined();
    expect(asset!.virtualPath).toBe('unlisted.css');
    expect(asset!.physicalPath).toBe(join(root0, 'unlisted.css'));
  });

  it('caches pattern hits into lookup for O(1) follow-up calls', () => {
    const a1 = vfs.resolve('unlisted.css');
    const a2 = vfs.resolve('unlisted.css');
    expect(a1).toBe(a2); // same object reference — second call hits the map
  });

  it('returns undefined for a path that does not exist on disk', () => {
    expect(vfs.resolve('really-not-there.txt')).toBeUndefined();
  });

  it('picks up a file added after the VFS was built', () => {
    // Simulates a file dropped by the user between rebuilds.
    writeFileSync(join(root0, 'dynamic.json'), '{}');
    const asset = vfs.resolve('dynamic.json');
    expect(asset).toBeDefined();
    expect(asset!.physicalPath).toBe(join(root0, 'dynamic.json'));
  });
});

// ---------------------------------------------------------------------------
// Synthetic: extension + index.* probing through pattern fallthrough
// ---------------------------------------------------------------------------

describe('buildVfs — synthetic: probing through pattern fallthrough', () => {
  let tmpRoot: string;
  let root0: string;
  let vfs: VirtualFileSystem;

  beforeAll(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'vfs-probe-'));
    root0 = join(tmpRoot, 'root0');
    mkdirSync(join(root0, 'some-dir'), { recursive: true });
    writeFileSync(join(root0, 'bare.ts'), 'export const bare = 1;');
    writeFileSync(join(root0, 'some-dir', 'index.ts'), 'export default 42;');

    vfs = buildVfs(
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
  });

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('extensionless bare specifier resolves via .ts probe', () => {
    const asset = vfs.resolve('bare');
    expect(asset).toBeDefined();
    expect(asset!.virtualPath).toBe('bare.ts');
    expect(asset!.physicalPath).toBe(join(root0, 'bare.ts'));
  });

  it('bare directory specifier resolves via index.ts probe', () => {
    const asset = vfs.resolve('some-dir');
    expect(asset).toBeDefined();
    expect(asset!.virtualPath).toBe('some-dir/index.ts');
    expect(asset!.physicalPath).toBe(join(root0, 'some-dir', 'index.ts'));
  });
});

// ---------------------------------------------------------------------------
// Synthetic: .ts shadows .d.ts (detection runs against manifest-listed assets)
// ---------------------------------------------------------------------------

describe('buildVfs — synthetic: .ts shadows .d.ts', () => {
  let vfs: VirtualFileSystem;

  beforeAll(() => {
    // Pure in-memory test — no disk needed because the detection inspects only
    // the enumerated Asset map.  Physical paths don't have to exist for this.
    vfs = buildVfs(
      parseRuntimeManifest(
        JSON.stringify({
          ContentRoots: ['/virt/'],
          Root: {
            Children: {
              'foo.ts':   { Children: null, Asset: { ContentRootIndex: 0, SubPath: 'foo.ts' },   Patterns: null },
              'foo.d.ts': { Children: null, Asset: { ContentRootIndex: 0, SubPath: 'foo.d.ts' }, Patterns: null },
              // bar.d.ts has no .ts sibling — should NOT trigger a shadow.
              'bar.d.ts': { Children: null, Asset: { ContentRootIndex: 0, SubPath: 'bar.d.ts' }, Patterns: null },
            },
            Asset: null,
            Patterns: null,
          },
        }),
      ),
    );
  });

  it('shadowedPairs contains both foo.ts and foo.d.ts', () => {
    expect(vfs.shadowedPairs.has('foo.ts')).toBe(true);
    expect(vfs.shadowedPairs.has('foo.d.ts')).toBe(true);
  });

  it('shadowedPairs does not include bar.d.ts (no .ts sibling)', () => {
    expect(vfs.shadowedPairs.has('bar.d.ts')).toBe(false);
  });

  it('resolve foo (extensionless) → foo.ts, not foo.d.ts', () => {
    const asset = vfs.resolve('foo');
    expect(asset).toBeDefined();
    expect(asset!.virtualPath).toBe('foo.ts');
  });

  it('resolve foo.d.ts (explicit) → foo.d.ts (exact match still works)', () => {
    const asset = vfs.resolve('foo.d.ts');
    expect(asset).toBeDefined();
    expect(asset!.virtualPath).toBe('foo.d.ts');
  });
});
