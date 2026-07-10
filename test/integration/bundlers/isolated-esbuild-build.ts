import { join } from 'node:path';
import type { DotnetAssetsOptions } from 'unplugin-dotnet-wasm';
import { IsolatedBundlerBuild } from './isolated-bundler-build';
import { Platform } from '../test-matrix';

export class IsolatedEsbuildBuild extends IsolatedBundlerBuild {
  constructor(fixtureDir: string, platform: Platform, label: string) { super('esbuild', fixtureDir, platform, label); }
  get entryChunk(): string { return join(this.assets, 'entry.js'); }

  async build(pluginOptions: DotnetAssetsOptions): Promise<void> {
    this.warnings.length = 0;
    const [esbuild, { default: DotnetAssets }] = await Promise.all([
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
      plugins: [DotnetAssets(pluginOptions)],
    });
    for (const w of result.warnings) this.warnings.push(w.text);
  }
}

