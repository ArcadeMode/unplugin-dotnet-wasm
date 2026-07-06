import type { DotnetAssetsOptions } from 'unplugin-dotnet-wasm';
import type { Platform } from '../test-matrix.js';
import { IsolatedBundlerBuild } from './isolated-bundler-build.js';
import { join } from 'node:path';

export class IsolatedRsbuildBuild extends IsolatedBundlerBuild {
  constructor(fixtureDir: string, platform: Platform, label: string) {
    if (platform !== 'browser') {
      throw new Error(`rsbuild does not support platform='${platform}'. Supported: browser.`);
    }
    super('rsbuild', fixtureDir, platform, label);
  }
  get entryChunk(): string { return join(this.assets, 'entry.js'); }

  async build(pluginOptions: DotnetAssetsOptions): Promise<void> {
    this.warnings.length = 0;
    const [{ createRsbuild }, { default: DotnetAssets }] = await Promise.all([
      import('@rsbuild/core'),
      import('unplugin-dotnet-wasm/rsbuild'),
    ]);

    const rsbuild = await createRsbuild({
      cwd: this.fixtureDir,
      rsbuildConfig: {
        source: { entry: { entry: this.entryPoint() } },
        output: {
          distPath: { root: this.outDir, js: 'assets', jsAsync: 'assets', assets: 'assets' },
          filename: { js: 'entry.js' },
          filenameHash: false,
          minify: false,
        },
        plugins: [DotnetAssets(pluginOptions)],
        tools: { htmlPlugin: false },
      },
    });
    await rsbuild.build();
  }
}

