import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseRuntimeManifest } from './manifest-runtime.js';
import { buildVfs, type VirtualFileSystem } from './vfs.js';
import { type Logger, NULL_LOGGER } from './logger.js';

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
const ROOT2 = resolve(LIBRARY_ROOT, 'bin', 'Debug', 'net10.0', 'wwwroot');             // build output (ContentRoot 2)

// ---------------------------------------------------------------------------
// Real fixture — core resolution scenarios
// ---------------------------------------------------------------------------

describe('buildVfs — real fixture', () => {
  let vfs: VirtualFileSystem;

  beforeAll(() => {
    vfs = buildVfs(parseRuntimeManifest(readFileSync(MANIFEST_PATH)));
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
  });

  it('resolve _framework/dotnet.d.ts → root 0 (source root)', () => {
    const asset = vfs.resolve('_framework/dotnet.d.ts');
    expect(asset).toBeDefined();
    expect(asset!.physicalPath).toBe(join(ROOT0, '_framework', 'dotnet.d.ts'));
  });

  // ── list() ────────────────────────────────────────────────────────────────

  it('list _framework returns direct children with full virtual paths', () => {
    const children = vfs.list('_framework');
    expect(children.some(c => /^_framework\/dotnet(\.[a-z0-9]+)?\.js$/.test(c))).toBe(true);
    expect(children).toContain('_framework/dotnet.d.ts');
    expect(children.some(c => /^_framework\/Library(\.[a-z0-9]+)?\.wasm$/.test(c))).toBe(true);
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
// Synthetic: .ts shadows .d.ts (detection runs against manifest-listed assets)
// ---------------------------------------------------------------------------

describe('buildVfs — synthetic: .ts shadows .d.ts', () => {
  let debugMessages: string[];
  let vfs: VirtualFileSystem;

  beforeAll(() => {
    debugMessages = [];
    const logger: Logger = { ...NULL_LOGGER, debug: msg => { debugMessages.push(msg); } };

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
      { logger },
    );
  });

  it('emits a debug warning mentioning foo.d.ts for the shadowed pair', () => {
    expect(debugMessages.some(m => m.includes('foo.d.ts'))).toBe(true);
  });

  it('does not emit a warning for bar.d.ts (no .ts sibling)', () => {
    expect(debugMessages.every(m => !m.includes('bar.d.ts'))).toBe(true);
  });

  it('resolve foo.d.ts (explicit) → foo.d.ts (exact match still works)', () => {
    const asset = vfs.resolve('foo.d.ts');
    expect(asset).toBeDefined();
    expect(asset!.virtualPath).toBe('foo.d.ts');
  });
});
