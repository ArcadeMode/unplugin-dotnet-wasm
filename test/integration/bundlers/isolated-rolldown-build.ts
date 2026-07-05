import { join } from 'node:path';
import type { DotnetAssetsOptions } from 'unplugin-dotnet-static-assets';
import type { Platform } from '../test-matrix.js';
import { IsolatedBundlerBuild, DOTNET_NODE_BUILTINS } from './isolated-bundler-build.js';

export class IsolatedRolldownBuild extends IsolatedBundlerBuild {
  constructor(fixtureDir: string, platform: Platform, label: string) { super('rolldown', fixtureDir, platform, label); }
  get entryChunk(): string { return join(this.assets, 'entry.js'); }

  async build(pluginOptions: DotnetAssetsOptions): Promise<void> {
    this.warnings.length = 0;
    const [{ rolldown }, { default: DotnetAssets }] = await Promise.all([
      import('rolldown'),
      import('unplugin-dotnet-static-assets/rolldown'),
    ]);

    // Mark Node builtins as external so rolldown doesn't warn on unresolved bare imports.
    // dotnet.js contains `import('module')`, `import('process')` etc. as fallback paths
    // that never execute in browser; marking them external prevents bundler warnings.
    const external = (id: string) => id.startsWith('node:') || DOTNET_NODE_BUILTINS.has(id);

    const bundle = await rolldown({
      input: this.entryPoint(),
      external,
      onwarn: (w) => this.warnings.push(w.message ?? String(w)),
      plugins: [DotnetAssets(pluginOptions)],
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
