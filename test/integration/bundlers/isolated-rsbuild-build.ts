import type { Configuration } from '@rspack/core';
import type { DotnetWasmOptions } from 'unplugin-dotnet-wasm';
import type { Platform } from '../test-matrix';
import { IsolatedBundlerBuild } from './isolated-bundler-build';
import { join } from 'node:path';

export class IsolatedRsbuildBuild extends IsolatedBundlerBuild {
  constructor(fixtureDir: string, platform: Platform, label: string) {
    super('rsbuild', fixtureDir, platform, label);
  }
  get entryChunk(): string {
    return join(this.assets, 'entry.js');
  }

  async build(pluginOptions: DotnetWasmOptions): Promise<void> {
    this.warnings.length = 0;
    const [{ createRsbuild }, { default: DotnetWasm }] = await Promise.all([
      import('@rsbuild/core'),
      import('unplugin-dotnet-wasm/rsbuild'),
    ]);

    const isNode = this.platform === 'node';
    const rsbuild = await createRsbuild({
      cwd: this.fixtureDir,
      rsbuildConfig: {
        source: { entry: { entry: this.entryPoint() } },
        output: {
          target: isNode ? 'node' : 'web',
          distPath: { root: this.outDir, js: 'assets', jsAsync: 'assets', assets: 'assets' },
          filename: { js: 'entry.js' },
          filenameHash: false,
          minify: false,
        },
        plugins: [DotnetWasm(pluginOptions)],
        tools: {
          htmlPlugin: false,
          // rsbuild's node target isn't ESM by default; force ESM module output (matching the
          // node fixture) so the dotnet loader's asset imports bundle.
          ...(isNode
            ? {
                rspack: (config: Configuration) => {
                  config.output = {
                    ...config.output,
                    module: true,
                    chunkFormat: 'module',
                    library: { type: 'module' },
                    publicPath: 'auto',
                  };
                },
              }
            : {}),
        },
      },
    });
    await rsbuild.build();
  }
}
