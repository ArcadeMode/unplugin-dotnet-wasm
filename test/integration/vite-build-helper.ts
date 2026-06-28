import { build as viteBuild, createLogger, type InlineConfig } from 'vite';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import DotnetAssets from 'unplugin-dotnet-static-assets/vite';
import type { DotnetAssetsOptions } from 'unplugin-dotnet-static-assets';

export class IsolatedViteBuild {
  readonly outDir: string;
  readonly warnings: string[] = [];
  private readonly id: string;
  private readonly cacheDir: string;

  constructor(label = 'smoke') {
    this.id = `${label}-${randomBytes(4).toString('hex')}`;
    const base = join(tmpdir(), 'dotnet-vite-smoke', this.id);
    this.outDir  = join(base, 'dist');
    this.cacheDir = join(base, '.vite');
  }

  get assets(): string {
    return join(this.outDir, 'assets');
  }

  async build(
    root: string,
    pluginOptions: DotnetAssetsOptions,
    extra: InlineConfig = {},
  ): Promise<void> {
    this.warnings.length = 0;
    const logger = createLogger('warn');
    const orig = logger.warn.bind(logger);
    logger.warn = (msg, opts) => { this.warnings.push(msg); orig(msg, opts); };

    await viteBuild({
      root,
      configFile: false,
      logLevel: 'warn',
      customLogger: logger,
      cacheDir: this.cacheDir,
      plugins: [DotnetAssets(pluginOptions)],
      ...extra,
      build: {
        outDir: this.outDir,
        rollupOptions: { input: resolve(root, 'index.html') },
        ...extra.build,
      },
    });
  }

  cleanup(): void {
    rmSync(join(tmpdir(), 'dotnet-vite-smoke', this.id), { recursive: true, force: true });
  }
}
