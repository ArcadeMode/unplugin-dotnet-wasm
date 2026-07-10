import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { dotnetStaticAssets } from './index';

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

const SAMPLE_ROOT = resolve(__dirname, '../../../samples/SampleLibrary');
const BIN_WWWROOT = resolve(SAMPLE_ROOT, 'bin', 'Debug', 'net10.0', 'wwwroot');
const PUBLISH_DIR = resolve(SAMPLE_ROOT, 'bin', 'Release', 'net10.0', 'publish');

describe('dotnetStaticAssets', () => {
  it('exports a plugin factory', () => {
    expect(typeof dotnetStaticAssets.vite).toBe('function');
  });
});

describe('dotnetStaticAssets — buildStart with isPublish: true', () => {
  it('initialises without throwing when pointing at a Release publish output', async () => {
    const plugin = dotnetStaticAssets.rollup({
      projectRoot: SAMPLE_ROOT,
      projectName: 'SampleLibrary',
      configuration: 'Release',
      targetFramework: 'net10.0',
      isPublish: true,
    });
    await expect(callBuildStart(plugin)).resolves.not.toThrow();
  });
});

describe('dotnetStaticAssets — buildStart with explicit dotnetOutputDir', () => {
  it('initialises without throwing when dotnetOutputDir points at the publish dir (no runtime.json)', async () => {
    const plugin = dotnetStaticAssets.rollup({
      projectName: 'SampleLibrary',
      dotnetOutputDir: PUBLISH_DIR,
    });
    await expect(callBuildStart(plugin)).resolves.not.toThrow();
  });
});

describe('dotnetStaticAssets — resolveId (real SampleLibrary fixture)', () => {
  let plugin: any;

  beforeAll(async () => {
    plugin = dotnetStaticAssets.rollup({
      projectRoot: SAMPLE_ROOT,
      projectName: 'SampleLibrary',
      configuration: 'Debug',
      targetFramework: 'net10.0',
    });
    await callBuildStart(plugin);
  });

  it('resolves _framework/dotnet.js to a physical path in root 2 (fingerprinted or canonical)', () => {
    const result = callResolveId(plugin, '_framework/dotnet.js');
    expect(result).not.toBeNull();
    expect(result).toContain(join(BIN_WWWROOT, '_framework'));
    expect(basename(result!)).toMatch(/^dotnet(\.[a-z0-9]+)?\.js$/);
  });

  it('resolves ./_framework/dotnet.js (leading ./) to the same path', () => {
    const result = callResolveId(plugin, './_framework/dotnet.js');
    expect(result).not.toBeNull();
    expect(result).toContain(join(BIN_WWWROOT, '_framework'));
    expect(basename(result!)).toMatch(/^dotnet(\.[a-z0-9]+)?\.js$/);
  });

  it('resolves /_framework/dotnet.js (leading /) to the same path', () => {
    const result = callResolveId(plugin, '/_framework/dotnet.js');
    expect(result).not.toBeNull();
    expect(result).toContain(join(BIN_WWWROOT, '_framework'));
    expect(basename(result!)).toMatch(/^dotnet(\.[a-z0-9]+)?\.js$/);
  });

  it('resolves typeshim (extensionless) to the generated typeshim.ts', () => {
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

describe('dotnetStaticAssets — load', () => {
  let plugin: any;
  let dotnetNativeWasm: string;
  let icudtDat: string;
  let libraryPdb: string;
  let typeshimTs: string;

  beforeAll(async () => {
    plugin = dotnetStaticAssets.rollup({
      projectRoot: SAMPLE_ROOT,
      projectName: 'SampleLibrary',
      configuration: 'Debug',
      targetFramework: 'net10.0',
    });
    await callBuildStart(plugin);

    const frameworkFiles = readdirSync(join(BIN_WWWROOT, '_framework'));
    const find = (pat: RegExp): string => {
      const name = frameworkFiles.find(f => pat.test(f));
      if (!name) throw new Error(`No file matching ${pat} in ${join(BIN_WWWROOT, '_framework')}`);
      return join(BIN_WWWROOT, '_framework', name);
    };
    dotnetNativeWasm = find(/^dotnet\.native(\.[a-z0-9]+)?\.wasm$/);
    icudtDat         = find(/^icudt_CJK(\.[a-z0-9]+)?\.dat$/);
    libraryPdb       = find(/^SampleLibrary(\.[a-z0-9]+)?\.pdb$/);
    typeshimTs       = callResolveId(plugin, 'typeshim')!;
  });

  it('returns undefined for a .ts file (falls through to Vite transformer)', async () => {
    const result = await callLoad(plugin, typeshimTs);
    expect(result).toBeUndefined();
  });

  it('returns undefined for a .js file', async () => {
    const result = await callLoad(plugin, join(BIN_WWWROOT, '_framework', 'dotnet.js'));
    expect(result).toBeUndefined();
  });

  it('emits a .wasm file as an asset and returns an import.meta.ROLLUP_FILE_URL reference', async () => {
    const emitFile = vi.fn().mockReturnValue('wasm-ref-abc');
    const result = await callLoad(plugin, dotnetNativeWasm, emitFile);
    expect(emitFile).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'asset', name: basename(dotnetNativeWasm) }),
    );
    expect(result).toBe('export default import.meta.ROLLUP_FILE_URL_wasm-ref-abc;');
  });

  it('emits a .dat file as an asset', async () => {
    const emitFile = vi.fn().mockReturnValue('dat-ref-xyz');
    const result = await callLoad(plugin, icudtDat, emitFile);
    expect(emitFile).toHaveBeenCalled();
    expect(result).toContain('import.meta.ROLLUP_FILE_URL_dat-ref-xyz');
  });

  it('emits a .pdb file as an asset', async () => {
    const emitFile = vi.fn().mockReturnValue('pdb-ref');
    const result = await callLoad(plugin, libraryPdb, emitFile);
    expect(emitFile).toHaveBeenCalled();
    expect(result).toContain('import.meta.ROLLUP_FILE_URL_pdb-ref');
  });
});

describe('dotnetStaticAssets — transform (FRAMEWORK_JS_REGEX scoping)', () => {
  let plugin: any;

  beforeAll(async () => {
    plugin = dotnetStaticAssets.rollup({
      projectRoot: SAMPLE_ROOT,
      projectName: 'SampleLibrary',
      configuration: 'Debug',
      targetFramework: 'net10.0',
    });
    await callBuildStart(plugin);
  });

  it('returns null for JS files outside the _framework directory', () => {
    const result = handler(plugin.transform)?.call(
      {},
      `import("process");`,
      '/some/other/project/app.js',
    );
    expect(result).toBeFalsy();
  });

  it('returns null for non-JS files inside the _framework directory', () => {
    const wasmPath = join(BIN_WWWROOT, '_framework', 'dotnet.native.wasm');
    const result = handler(plugin.transform)?.call({}, `import("process");`, wasmPath);
    expect(result).toBeFalsy();
  });
});

