import { build as viteBuild, createLogger, type InlineConfig } from 'vite';
import { join, resolve } from 'node:path';
import { readdirSync } from 'node:fs';
import DotnetAssetsVite from 'unplugin-dotnet-static-assets/vite';
import type { DotnetAssetsOptions } from 'unplugin-dotnet-static-assets';
import { IsolatedBundlerBuild } from './isolated-bundler-build.js';

export class IsolatedViteBuild extends IsolatedBundlerBuild {
  private readonly cacheDir: string;

  constructor(fixtureDir: string, label: string) {
    super('vite', fixtureDir, label);
    this.cacheDir = join(this.baseDir, '.vite');
  }

  get entryChunk(): string {
    // Vite hashes the entry chunk; discover it once dist is written.
    const files = readdirSync(this.assets);
    const entry = files.find(f => /^index-.*\.js$/.test(f));
    if (!entry) throw new Error(`Vite entry chunk not found under ${this.assets}`);
    return join(this.assets, entry);
  }

  async build(pluginOptions: DotnetAssetsOptions, extra: InlineConfig = {}): Promise<void> {
    this.warnings.length = 0;
    const logger = createLogger('warn');
    const orig = logger.warn.bind(logger);
    logger.warn = (msg, opts) => { this.warnings.push(msg); orig(msg, opts); };

    await viteBuild({
      root: this.fixtureDir,
      configFile: false,
      logLevel: 'warn',
      customLogger: logger,
      cacheDir: this.cacheDir,
      plugins: [DotnetAssetsVite(pluginOptions)],
      ...extra,
      build: {
        outDir: this.outDir,
        rollupOptions: { input: resolve(this.fixtureDir, 'index.html') },
        ...extra.build,
      },
    });
  }
}
