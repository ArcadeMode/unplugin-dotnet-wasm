import { join } from 'node:path';
import type { DotnetAssetsOptions } from 'unplugin-dotnet-static-assets';
import { IsolatedBundlerBuild } from './isolated-bundler-build.js';

export class IsolatedWebpackBuild extends IsolatedBundlerBuild {
  constructor(fixtureDir: string, label: string) { super('webpack', fixtureDir, label); }
  get entryChunk(): string { return join(this.assets, 'entry.js'); }

  async build(pluginOptions: DotnetAssetsOptions): Promise<void> {
    this.warnings.length = 0;
    const [{ default: webpack }, { default: DotnetAssets }] = await Promise.all([
      import('webpack'),
      import('unplugin-dotnet-static-assets/webpack'),
    ]);

    await new Promise<void>((resolveP, rejectP) => {
      webpack({
        mode: 'production',
        target: 'web',
        entry: this.entryPoint(),
        output: {
          path: this.outDir,
          filename: 'assets/entry.js',
          assetModuleFilename: 'assets/[name]-[contenthash][ext]',
          publicPath: '',
          clean: true,
        },
        resolve: { extensions: ['.ts', '.js'] },
        module: {
          rules: [{
            test: /\.ts$/,
            loader: 'ts-loader',
            options: { transpileOnly: true },
            exclude: /node_modules/,
          }],
        },
        optimization: { minimize: false },
        plugins: [DotnetAssets(pluginOptions)],
      }, (err, stats) => {
        if (err) return rejectP(err);
        if (stats?.hasErrors()) {
          const info = stats.toJson({ errors: true, warnings: true });
          for (const w of info.warnings ?? []) this.warnings.push(w.message);
          return rejectP(new Error(info.errors?.map(e => e.message).join('\n') ?? 'webpack build failed'));
        }
        for (const w of stats?.toJson({ warnings: true }).warnings ?? []) {
          this.warnings.push(w.message);
        }
        resolveP();
      });
    });
  }
}
