import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BundlerCompatRewriter } from '../bundler-compat-rewriter';
import type { Logger } from '../logger';
import type { AssetResolver } from './asset-resolver';
import { VirtualModuleResolver } from './virtual-module-resolver';

const nullLogger: Logger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};

function writeTempJs(name: string, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'dotnet-wasm-vmr-'));
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
}

describe('VirtualModuleResolver.load rewriter scoping', () => {
  it('rewrites _framework/dotnet.js dynamic imports', async () => {
    const physical = writeTempJs('dotnet.js', 'import("./dotnet.runtime.js");');
    const resolver = {
      resolve: vi.fn(() => physical),
    } as unknown as AssetResolver;
    const vmr = new VirtualModuleResolver(
      resolver,
      new BundlerCompatRewriter('webpack'),
      nullLogger,
      'webpack',
    );

    const result = await vmr.load(resolver, '_framework/dotnet.js');

    expect(result?.code).toContain('webpackIgnore: true');
  });

  it('does not rewrite blazor.webassembly.js (keeps relative import("./dotnet.js") bundler-visible)', async () => {
    const physical = writeTempJs('blazor.webassembly.js', 'return await import("./dotnet.js");');
    const resolver = {
      resolve: vi.fn(() => physical),
    } as unknown as AssetResolver;
    const vmr = new VirtualModuleResolver(
      resolver,
      new BundlerCompatRewriter('webpack'),
      nullLogger,
      'webpack',
    );

    const result = await vmr.load(resolver, '_framework/blazor.webassembly.js');

    expect(result?.code).toBe('return await import("./dotnet.js");');
    expect(result?.code).not.toContain('webpackIgnore');
  });
});
