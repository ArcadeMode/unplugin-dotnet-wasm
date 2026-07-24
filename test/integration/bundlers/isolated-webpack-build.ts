import { join } from 'node:path';
import type { DotnetAssetsOptions } from 'unplugin-dotnet-wasm';
import type { Platform } from '../test-matrix';
import { IsolatedBundlerBuild } from './isolated-bundler-build';

export class IsolatedWebpackBuild extends IsolatedBundlerBuild {
  constructor(fixtureDir: string, platform: Platform, label: string) {
    super('webpack', fixtureDir, platform, label);
  }
  get entryChunk(): string {
    return join(this.assets, 'entry.js');
  }

  async build(pluginOptions: DotnetAssetsOptions): Promise<void> {
    this.warnings.length = 0;
    const [{ default: webpack }, { default: DotnetAssets }] = await Promise.all([
      import('webpack'),
      import('unplugin-dotnet-wasm/webpack'),
    ]);

    const isNode = this.platform === 'node';
    // Node output must be ESM so the dotnet loader's `import "./<asset>"` statements bundle.
    const config: import('webpack').Configuration = {
      mode: 'production',
      target: isNode ? 'node' : 'web',
      entry: this.entryPoint(),
      experiments: isNode ? { outputModule: true } : undefined,
      output: {
        path: this.outDir,
        filename: 'assets/entry.js',
        assetModuleFilename: 'assets/[name]-[contenthash][ext]',
        clean: true,
        ...(isNode
          ? { module: true, chunkFormat: 'module', library: { type: 'module' }, publicPath: 'auto' }
          : { publicPath: '' }),
      },
      resolve: { extensions: ['.ts', '.js'] },
      module: {
        rules: [
          {
            test: /\.ts$/,
            loader: 'ts-loader',
            options: { transpileOnly: true },
            exclude: /node_modules/,
          },
        ],
      },
      optimization: { minimize: false },
      plugins: [DotnetAssets(pluginOptions)],
    };

    await new Promise<void>((resolveP, rejectP) => {
      webpack(
        config,
        (err, stats) => {
          if (err) return rejectP(err);
          if (stats?.hasErrors()) {
            const info = stats.toJson({ errors: true, warnings: true });
            for (const w of info.warnings ?? []) this.warnings.push(w.message);
            return rejectP(
              new Error(info.errors?.map((e) => e.message).join('\n') ?? 'webpack build failed'),
            );
          }
          for (const w of stats?.toJson({ warnings: true }).warnings ?? []) {
            this.warnings.push(w.message);
          }
          resolveP();
        },
      );
    });
  }
}
