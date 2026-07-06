import { build as viteBuild, createLogger, type InlineConfig } from 'vite';
import { join, resolve } from 'node:path';
import { readdirSync } from 'node:fs';
import DotnetAssetsVite from 'unplugin-dotnet-wasm/vite';
import type { DotnetAssetsOptions } from 'unplugin-dotnet-wasm';
import type { Platform } from '../test-matrix.js';
import { IsolatedBundlerBuild } from './isolated-bundler-build.js';

export class IsolatedViteBuild extends IsolatedBundlerBuild {
  private readonly cacheDir: string;

  constructor(fixtureDir: string, platform: Platform, label: string) {
    super('vite', fixtureDir, platform, label);
    this.cacheDir = join(this.baseDir, '.vite');
  }

  get entryChunk(): string {
    const files = readdirSync(this.assets);
    if (this.platform === 'node') {
      // Node: entry.js is output directly without hashing
      const entry = files.find(f => f === 'entry.js');
      if (!entry) throw new Error(`Vite Node entry chunk not found under ${this.assets}`);
      return join(this.assets, entry);
    } else {
      // Browser: Vite hashes the entry chunk; discover it once dist is written.
      const entry = files.find(f => /^index-.*\.js$/.test(f));
      if (!entry) throw new Error(`Vite browser entry chunk not found under ${this.assets}`);
      return join(this.assets, entry);
    }
  }

  async build(pluginOptions: DotnetAssetsOptions, extra: InlineConfig = {}): Promise<void> {
    this.warnings.length = 0;
    const logger = createLogger('warn');
    const orig = logger.warn.bind(logger);
    logger.warn = (msg, opts) => { this.warnings.push(msg); orig(msg, opts); };

    const rollupOptions = this.platform === 'node'
      ? { 
          input: resolve(this.fixtureDir, 'src/entry.ts'), 
          output: { format: 'es' as const, entryFileNames: 'assets/entry.js' } 
        }
      : { input: resolve(this.fixtureDir, 'index.html') };

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
        rollupOptions,
        ...extra.build,
      },
    });
  }
}

