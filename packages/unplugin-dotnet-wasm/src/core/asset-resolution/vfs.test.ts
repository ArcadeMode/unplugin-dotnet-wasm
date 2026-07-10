import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseRuntimeManifest } from '../manifest-parsing/manifest-runtime';
import { buildVfs, type VirtualFileSystem } from './vfs';
import { type Logger, NULL_LOGGER } from '../logger';

const SAMPLE_ROOT = resolve(__dirname, '../../../../samples/SampleLibrary');
const MANIFEST_PATH = resolve(
  SAMPLE_ROOT,
  'bin/Debug/net10.0/SampleLibrary.staticwebassets.runtime.json',
);
const BIN_WWWROOT = resolve(SAMPLE_ROOT, 'bin', 'Debug', 'net10.0', 'wwwroot');

describe('buildVfs with real fixture', () => {
  let vfs: VirtualFileSystem;

  beforeAll(() => {
    vfs = buildVfs(parseRuntimeManifest(readFileSync(MANIFEST_PATH)));
  });

  it('resolves fingerprinted dotnet.*.js to the bin output', () => {
    const fpPath = vfs.list('_framework').find(p => /\/dotnet\.[a-z0-9]+\.js$/.test(p));
    expect(fpPath, 'expected a fingerprinted dotnet.*.js in the VFS listing').toBeDefined();
    const asset = vfs.resolve(fpPath!);
    expect(asset).toBeDefined();
    expect(asset!.physicalPath).toContain(join(BIN_WWWROOT, '_framework'));
    expect(asset!.physicalPath).toMatch(/dotnet\.[a-z0-9]+\.js$/);
  });

  it('list _framework returns direct children with full virtual paths', () => {
    const children = vfs.list('_framework');
    expect(children.some(c => /^_framework\/dotnet(\.[a-z0-9]+)?\.js$/.test(c))).toBe(true);
    expect(children.some(c => /^_framework\/SampleLibrary(\.[a-z0-9]+)?\.wasm$/.test(c))).toBe(true);
    for (const c of children) {
      expect(c.split('/'), `"${c}" should have exactly 2 segments`).toHaveLength(2);
    }
  });

  it('list returns sorted results', () => {
    const children = vfs.list('_framework');
    const sorted = [...children].sort();
    expect(children).toEqual(sorted);
  });

  it('returns undefined for a path that does not exist', () => {
    expect(vfs.resolve('does-not-exist.ts')).toBeUndefined();
    expect(vfs.resolve('_framework/nonexistent.wasm')).toBeUndefined();
  });

});

const TEMP_DIR = resolve(__dirname, '../../.test-tmp/vfs-pat');

describe('buildVfs with synthetic manifest: pattern fallthrough', () => {
  let root0: string;
  let vfs: VirtualFileSystem;

  beforeAll(() => {
    root0 = join(TEMP_DIR, 'root0');
    rmSync(TEMP_DIR, { recursive: true, force: true });
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
    rmSync(TEMP_DIR, { recursive: true, force: true });
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

describe('buildVfs with synthetic manifest: logging', () => {
  let messages: string[];
  let vfs: VirtualFileSystem;

  beforeAll(() => {
    messages = [];
    const logger: Logger = {
      ...NULL_LOGGER,
      debug: msg => { messages.push(msg); },
      info: msg => { messages.push(msg); },
    };

    vfs = buildVfs(
      parseRuntimeManifest(
        JSON.stringify({
          ContentRoots: ['/virt/'],
          Root: {
            Children: {
              'app.js': { Children: null, Asset: { ContentRootIndex: 0, SubPath: 'app.js' }, Patterns: null },
            },
            Asset: null,
            Patterns: [{ ContentRootIndex: 0, Pattern: '**', Depth: 0 }],
          },
        }),
      ),
      { logger },
    );
  });

  it('emits an info line summarizing VFS construction', () => {
    expect(messages.some(m => m.includes('VFS constructed:'))).toBe(true);
    expect(messages.some(m => m.includes('manifest assets'))).toBe(true);
  });

  it('emits a debug line when resolve misses', () => {
    vfs.resolve('does-not-exist.js');
    expect(messages.some(m => m.includes('could not resolve:') && m.includes('does-not-exist.js'))).toBe(true);
  });
});
