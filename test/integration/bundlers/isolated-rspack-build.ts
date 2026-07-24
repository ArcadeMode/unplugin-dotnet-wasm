import { join } from 'node:path';
import type { DotnetAssetsOptions } from 'unplugin-dotnet-wasm';
import type { Platform } from '../test-matrix';
import { IsolatedBundlerBuild } from './isolated-bundler-build';

export class IsolatedRspackBuild extends IsolatedBundlerBuild {
  constructor(fixtureDir: string, platform: Platform, label: string) {
    super('rspack', fixtureDir, platform, label);
  }
  get entryChunk(): string {
    return join(this.assets, 'entry.js');
  }

  async build(pluginOptions: DotnetAssetsOptions): Promise<void> {
    this.warnings.length = 0;
    const [{ rspack }, { default: DotnetAssets }] = await Promise.all([
      import('@rspack/core'),
      import('unplugin-dotnet-wasm/rspack'),
    ]);

    const isNode = this.platform === 'node';
    // Node output must be ESM. rspack's node publicPath defaults to empty (bare relative asset
    // URLs), so `publicPath: 'auto'` is set for parity with the fixture — harmless here since the
    // integration test inspects emitted files rather than executing the bundle.
    const config: import('@rspack/core').Configuration = {
      mode: 'production',
      target: isNode ? 'node' : 'web',
      entry: { main: this.entryPoint() },
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
            exclude: /node_modules/,
            loader: 'builtin:swc-loader',
            options: {
              jsc: { parser: { syntax: 'typescript' } },
              env: { targets: 'defaults' },
            },
            type: 'javascript/auto',
          },
        ],
      },
      optimization: { minimize: false },
      plugins: [DotnetAssets(pluginOptions)],
    };

    await new Promise<void>((resolveP, rejectP) => {
      rspack(
        config,
        (err, stats) => {
          if (err) return rejectP(err);
          if (stats?.hasErrors()) {
            const info = stats.toJson({ errors: true, warnings: true });
            for (const w of info.warnings ?? []) this.warnings.push(w.message);
            return rejectP(
              new Error(info.errors?.map((e) => e.message).join('\n') ?? 'rspack build failed'),
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
