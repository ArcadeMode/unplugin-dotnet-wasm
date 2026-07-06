import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import type { DotnetAssetsOptions } from 'unplugin-dotnet-wasm';
import type { Platform } from '../test-matrix.js';
import { IsolatedBundlerBuild } from './isolated-bundler-build.js';

export class IsolatedFarmBuild extends IsolatedBundlerBuild {
  constructor(fixtureDir: string, platform: Platform, label: string) { super('farm', fixtureDir, platform, label); }
  get entryChunk(): string {
    // Both platforms use hashed output; find index chunk.
    const files = readdirSync(this.assets);
    const entry = files.find(f => /^index[._-].+\.js$/.test(f));
    if (!entry) throw new Error(`Farm entry chunk not found under ${this.assets}`);
    return join(this.assets, entry);
  }

  async build(pluginOptions: DotnetAssetsOptions): Promise<void> {
    this.warnings.length = 0;
    const [{ build }, { default: DotnetAssets }] = await Promise.all([
      import('@farmfe/core'),
      import('unplugin-dotnet-wasm/farm'),
    ]);

    // Platform-specific targetEnv; both use hashed filenames
    const targetEnv = this.platform === 'node' ? ('node-next' as const) : ('browser-esnext' as const);

    await build({
      root: this.fixtureDir,
      compilation: {
        input: { index: this.entryPoint() },
        output: {
          path: this.outDir,
          filename: 'assets/[name].[hash].[ext]',
          assetsFilename: 'assets/[name].[hash].[ext]',
          publicPath: '/',
          targetEnv,
        },
        assets: { include: ['wasm', 'dat', 'pdb'] },
        minify: false,
        persistentCache: false,
        progress: false,
      },
      server: { hmr: false },
      plugins: [DotnetAssets(pluginOptions)],
    });
  }
}

