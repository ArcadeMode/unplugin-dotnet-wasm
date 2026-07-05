import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import type { DotnetAssetsOptions } from 'unplugin-dotnet-static-assets';
import type { Platform } from '../test-matrix.js';
import { IsolatedBundlerBuild } from './isolated-bundler-build.js';

export class IsolatedFarmBuild extends IsolatedBundlerBuild {
  constructor(fixtureDir: string, platform: Platform, label: string) { super('farm', fixtureDir, platform, label); }
  get entryChunk(): string {
    // Farm emits `assets/index_<hash>.<hash>.js`; find it.
    const files = readdirSync(this.assets);
    const entry = files.find(f => /^index[_-].+\.js$/.test(f));
    if (!entry) throw new Error(`Farm entry chunk not found under ${this.assets}`);
    return join(this.assets, entry);
  }

  async build(pluginOptions: DotnetAssetsOptions): Promise<void> {
    this.warnings.length = 0;
    const [{ build }, { default: DotnetAssets }] = await Promise.all([
      import('@farmfe/core'),
      import('unplugin-dotnet-static-assets/farm'),
    ]);

    await build({
      root: this.fixtureDir,
      compilation: {
        input: { index: this.entryPoint() },
        output: {
          path: this.outDir,
          filename: 'assets/[name].[hash].[ext]',
          assetsFilename: 'assets/[name].[hash].[ext]',
          publicPath: '/',
          targetEnv: 'browser-esnext',
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
