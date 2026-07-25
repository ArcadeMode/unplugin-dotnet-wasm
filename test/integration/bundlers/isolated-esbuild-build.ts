import { join } from 'node:path';
import type { DotnetWasmOptions } from 'unplugin-dotnet-wasm';
import { IsolatedBundlerBuild } from './isolated-bundler-build';
import type { Platform } from '../test-matrix';

export class IsolatedEsbuildBuild extends IsolatedBundlerBuild {
  constructor(fixtureDir: string, platform: Platform, label: string) {
    super('esbuild', fixtureDir, platform, label);
  }
  get entryChunk(): string {
    return join(this.assets, 'entry.js');
  }

  async build(pluginOptions: DotnetWasmOptions): Promise<void> {
    this.warnings.length = 0;
    const [esbuild, { default: DotnetWasm }] = await Promise.all([
      import('esbuild'),
      import('unplugin-dotnet-wasm/esbuild'),
    ]);

    const result = await esbuild.build({
      entryPoints: [this.entryPoint()],
      outdir: this.outDir,
      bundle: true,
      format: 'esm',
      platform: 'browser',
      entryNames: 'assets/entry',
      assetNames: 'assets/[name]-[hash]',
      logLevel: 'silent',
      plugins: [DotnetWasm(pluginOptions)],
    });
    for (const w of result.warnings) this.warnings.push(w.text);
  }
}
