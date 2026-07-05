import { join } from 'node:path';
import type { DotnetAssetsOptions } from 'unplugin-dotnet-static-assets';
import type { Platform } from '../test-matrix.js';
import { IsolatedBundlerBuild } from './isolated-bundler-build.js';

export class IsolatedRspackBuild extends IsolatedBundlerBuild {
  constructor(fixtureDir: string, platform: Platform, label: string) {
    if (platform !== 'browser') {
      throw new Error(`rspack does not support platform='${platform}'. Supported: browser.`);
    }
    super('rspack', fixtureDir, platform, label);
  }
  get entryChunk(): string { return join(this.assets, 'entry.js'); }

  async build(pluginOptions: DotnetAssetsOptions): Promise<void> {
    this.warnings.length = 0;
    const [{ rspack }, { default: DotnetAssets }] = await Promise.all([
      import('@rspack/core'),
      import('unplugin-dotnet-static-assets/rspack'),
    ]);

    await new Promise<void>((resolveP, rejectP) => {
      rspack({
        mode: 'production',
        target: 'web',
        entry: { main: this.entryPoint() },
        output: {
          path: this.outDir,
          filename: 'assets/entry.js',
          assetModuleFilename: 'assets/[name]-[contenthash][ext]',
          publicPath: '',
          clean: true,
        },
        module: {
          rules: [{
            test: /\.ts$/,
            exclude: /node_modules/,
            loader: 'builtin:swc-loader',
            options: {
              jsc: { parser: { syntax: 'typescript' } },
              env: { targets: 'defaults' },
            },
            type: 'javascript/auto',
          }],
        },
        optimization: { minimize: false },
        plugins: [DotnetAssets(pluginOptions)],
      }, (err, stats) => {
        if (err) return rejectP(err);
        if (stats?.hasErrors()) {
          const info = stats.toJson({ errors: true, warnings: true });
          for (const w of info.warnings ?? []) this.warnings.push(w.message);
          return rejectP(new Error(info.errors?.map(e => e.message).join('\n') ?? 'rspack build failed'));
        }
        for (const w of stats?.toJson({ warnings: true }).warnings ?? []) {
          this.warnings.push(w.message);
        }
        resolveP();
      });
    });
  }
}
