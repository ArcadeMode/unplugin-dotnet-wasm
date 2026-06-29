import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { dotnetStaticAssets } from './index.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the handler function from a hook that may be either a plain
 * function or a Rollup v4 `{ order, handler }` descriptor object.
 */
function handler<T extends (...args: any[]) => any>(
  hook: T | { handler: T; order?: string } | null | undefined,
): T | undefined {
  if (!hook) return undefined;
  if (typeof hook === 'function') return hook;
  return (hook as { handler: T }).handler;
}

async function callBuildStart(plugin: any): Promise<void> {
  await handler(plugin.buildStart)?.call({});
}

function callResolveId(plugin: any, source: string): string | null | undefined {
  return handler(plugin.resolveId)?.call({}, source, undefined, {});
}

function callLoad(
  plugin: any,
  id: string,
  emitFileMock = vi.fn().mockReturnValue('ref-id'),
): any {
  return handler(plugin.load)?.call({ emitFile: emitFileMock }, id);
}

// ---------------------------------------------------------------------------
// Fixture paths
// ---------------------------------------------------------------------------

const LIBRARY_ROOT = resolve(__dirname, '../../../../test/fixtures/Library');
const ROOT0 = resolve(LIBRARY_ROOT, 'wwwroot');
const ROOT2 = resolve(LIBRARY_ROOT, 'bin', 'Debug', 'net10.0', 'wwwroot');
const PUBLISH_DIR = resolve(LIBRARY_ROOT, 'bin', 'Release', 'net10.0', 'publish');

// ---------------------------------------------------------------------------
// Smoke test
// ---------------------------------------------------------------------------

describe('dotnetStaticAssets', () => {
  it('exports a plugin factory', () => {
    expect(typeof dotnetStaticAssets.vite).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// buildStart smoke — publish paths
// ---------------------------------------------------------------------------

describe('dotnetStaticAssets — buildStart with isPublish: true', () => {
  it('initialises without throwing when pointing at a Release publish output', async () => {
    const plugin = dotnetStaticAssets.rollup({
      projectRoot: LIBRARY_ROOT,
      projectName: 'Library',
      configuration: 'Release',
      targetFramework: 'net10.0',
      isPublish: true,
    });
    await expect(callBuildStart(plugin)).resolves.not.toThrow();
  });
});

describe('dotnetStaticAssets — buildStart with explicit manifestPath', () => {
  it('initialises without throwing when manifestPath points at the publish dir (no runtime.json)', async () => {
    const plugin = dotnetStaticAssets.rollup({
      projectName: 'Library',
      manifestPath: join(PUBLISH_DIR, 'Library.staticwebassets.runtime.json'),
    });
    await expect(callBuildStart(plugin)).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// resolveId — virtual-path lookup
// ---------------------------------------------------------------------------

describe('dotnetStaticAssets — resolveId (real Library fixture)', () => {
  let plugin: any;

  beforeAll(async () => {
    plugin = dotnetStaticAssets.rollup({
      projectRoot: LIBRARY_ROOT,
      projectName: 'Library',
      configuration: 'Debug',
      targetFramework: 'net10.0',
    });
    await callBuildStart(plugin);
  });

  it('resolves _framework/dotnet.js to a physical path in root 2 (fingerprinted or canonical)', () => {
    const result = callResolveId(plugin, '_framework/dotnet.js');
    expect(result).not.toBeNull();
    expect(result).toContain(join(ROOT2, '_framework'));
    expect(basename(result!)).toMatch(/^dotnet(\.[a-z0-9]+)?\.js$/);
  });

  it('resolves ./_framework/dotnet.js (leading ./) to the same path', () => {
    const result = callResolveId(plugin, './_framework/dotnet.js');
    expect(result).not.toBeNull();
    expect(result).toContain(join(ROOT2, '_framework'));
    expect(basename(result!)).toMatch(/^dotnet(\.[a-z0-9]+)?\.js$/);
  });

  it('resolves /_framework/dotnet.js (leading /) to the same path', () => {
    const result = callResolveId(plugin, '/_framework/dotnet.js');
    expect(result).not.toBeNull();
    expect(result).toContain(join(ROOT2, '_framework'));
    expect(basename(result!)).toMatch(/^dotnet(\.[a-z0-9]+)?\.js$/);
  });

  it('resolves _framework/dotnet.d.ts to root 0 (source)', () => {
    const result = callResolveId(plugin, '_framework/dotnet.d.ts');
    expect(result).toBe(join(ROOT0, '_framework', 'dotnet.d.ts'));
  });

  it('resolves typeshim (extensionless) to the generated typeshim.ts in the obj dir', () => {
    const result = callResolveId(plugin, 'typeshim');
    expect(typeof result).toBe('string');
    expect(result).toMatch(/typeshim\.ts$/);
    expect(result).toMatch(/TypeShim/);
  });

  it('resolves ./typeshim (leading ./) to the same path', () => {
    const result = callResolveId(plugin, './typeshim');
    expect(result).toMatch(/typeshim\.ts$/);
  });

  it('returns null for an unrecognized bare specifier (react)', () => {
    const result = callResolveId(plugin, 'react');
    expect(result).toBeNull();
  });

  it('returns null for a specifier with no manifest entry', () => {
    const result = callResolveId(plugin, 'does-not-exist.ts');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// load — binary asset handler
// ---------------------------------------------------------------------------

describe('dotnetStaticAssets — load', () => {
  let plugin: any;
  // Asset names may be fingerprinted (WasmFingerprintAssets=true) or canonical.
  // Discover them at test-file setup time so we never hardcode hash segments.
  let dotnetNativeWasm: string;
  let icudtDat: string;
  let libraryPdb: string;

  beforeAll(async () => {
    plugin = dotnetStaticAssets.rollup({
      projectRoot: LIBRARY_ROOT,
      projectName: 'Library',
      configuration: 'Debug',
      targetFramework: 'net10.0',
    });
    await callBuildStart(plugin);

    const frameworkFiles = readdirSync(join(ROOT2, '_framework'));
    const find = (pat: RegExp): string => {
      const name = frameworkFiles.find(f => pat.test(f));
      if (!name) throw new Error(`No file matching ${pat} in ${join(ROOT2, '_framework')}`);
      return join(ROOT2, '_framework', name);
    };
    dotnetNativeWasm = find(/^dotnet\.native(\.[a-z0-9]+)?\.wasm$/);
    icudtDat         = find(/^icudt_CJK(\.[a-z0-9]+)?\.dat$/);
    libraryPdb       = find(/^Library(\.[a-z0-9]+)?\.pdb$/);
  });

  it('returns null for a .ts file (falls through to Vite transformer)', () => {
    const result = callLoad(plugin, join(ROOT0, 'main.ts'));
    expect(result).toBeNull();
  });

  it('returns null for a .js file', () => {
    const result = callLoad(plugin, join(ROOT2, '_framework', 'dotnet.js'));
    expect(result).toBeNull();
  });

  it('emits a .wasm file as an asset and returns an import.meta.ROLLUP_FILE_URL reference', () => {
    const emitFile = vi.fn().mockReturnValue('wasm-ref-abc');
    const result = callLoad(plugin, dotnetNativeWasm, emitFile);
    expect(emitFile).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'asset', name: basename(dotnetNativeWasm) }),
    );
    expect(result).toBe('export default import.meta.ROLLUP_FILE_URL_wasm-ref-abc;');
  });

  it('emits a .dat file as an asset', () => {
    const emitFile = vi.fn().mockReturnValue('dat-ref-xyz');
    const result = callLoad(plugin, icudtDat, emitFile);
    expect(emitFile).toHaveBeenCalled();
    expect(result).toContain('import.meta.ROLLUP_FILE_URL_dat-ref-xyz');
  });

  it('emits a .pdb file as an asset', () => {
    const emitFile = vi.fn().mockReturnValue('pdb-ref');
    const result = callLoad(plugin, libraryPdb, emitFile);
    expect(emitFile).toHaveBeenCalled();
    expect(result).toContain('import.meta.ROLLUP_FILE_URL_pdb-ref');
  });
});

