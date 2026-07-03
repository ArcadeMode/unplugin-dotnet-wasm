import { join } from 'node:path';
import type { DotnetAssetsOptions } from 'unplugin-dotnet-static-assets';
import { IsolatedBundlerBuild, DOTNET_NODE_BUILTINS } from './isolated-bundler-build.js';

export class IsolatedRolldownBuild extends IsolatedBundlerBuild {
  constructor(fixtureDir: string, label: string) { super('rolldown', fixtureDir, label); }
  get entryChunk(): string { return join(this.assets, 'entry.js'); }

  async build(pluginOptions: DotnetAssetsOptions): Promise<void> {
    this.warnings.length = 0;
    const [{ rolldown }, { default: DotnetAssets }] = await Promise.all([
      import('rolldown'),
      import('unplugin-dotnet-static-assets/rolldown'),
    ]);

    const bundle = await rolldown({
      input: this.entryPoint(),
      // dotnet.js contains `import('module')`, `import('process')` etc. as
      // fallback paths that never execute in the browser. Mark them external
      // so rolldown doesn't warn/error on the unresolved bare Node builtins.
      external: (id) => id.startsWith('node:') || DOTNET_NODE_BUILTINS.has(id),
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
