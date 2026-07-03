import type { DotnetAssetsOptions } from 'unplugin-dotnet-static-assets';
import { IsolatedBundlerBuild } from './isolated-bundler-build.js';
import { join } from 'node:path';

export class IsolatedRsbuildBuild extends IsolatedBundlerBuild {
  constructor(fixtureDir: string, label: string) { super('rsbuild', fixtureDir, label); }
  get entryChunk(): string { return join(this.assets, 'entry.js'); }

  async build(pluginOptions: DotnetAssetsOptions): Promise<void> {
    this.warnings.length = 0;
    const [{ createRsbuild }, { default: DotnetAssets }] = await Promise.all([
      import('@rsbuild/core'),
      import('unplugin-dotnet-static-assets/rsbuild'),
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
