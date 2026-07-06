import { join } from 'node:path';
import type { DotnetAssetsOptions } from 'unplugin-dotnet-wasm';
import type { Platform } from '../test-matrix.js';
import { IsolatedBundlerBuild } from './isolated-bundler-build.js';

export class IsolatedRollupBuild extends IsolatedBundlerBuild {
  constructor(fixtureDir: string, platform: Platform, label: string) { super('rollup', fixtureDir, platform, label); }
  get entryChunk(): string { return join(this.assets, 'entry.js'); }

  async build(pluginOptions: DotnetAssetsOptions): Promise<void> {
    this.warnings.length = 0;
    const [{ rollup }, { default: nodeResolve }, { default: esbuildPlugin }, { default: DotnetAssets }] = await Promise.all([
      import('rollup'),
      import('@rollup/plugin-node-resolve'),
      import('rollup-plugin-esbuild'),
      import('unplugin-dotnet-wasm/rollup'),
    ]);

    // Platform-specific plugins: browser uses nodeResolve with browser: true,
    // node does not use nodeResolve (relies on Node builtin module resolution)
    const plugins = [
      DotnetAssets(pluginOptions),
      ...(this.platform === 'browser' ? [nodeResolve({ browser: true })] : []),
      esbuildPlugin({ target: 'es2022' }),
    ];

    const bundle = await rollup({
      input: this.entryPoint(),
      onwarn: (w) => this.warnings.push(w.message ?? String(w)),
      plugins,
    });
    await bundle.write({
      dir: this.outDir,
      format: 'esm',
      entryFileNames: 'assets/entry.js',
      assetFileNames: 'assets/[name]-[hash][extname]',
    });
    await bundle.close();
  }
}

