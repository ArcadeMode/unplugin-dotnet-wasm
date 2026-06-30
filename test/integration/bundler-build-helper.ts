import { build as viteBuild, createLogger, type InlineConfig } from 'vite';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import DotnetAssets from 'unplugin-dotnet-static-assets/vite';
import type { DotnetAssetsOptions } from 'unplugin-dotnet-static-assets';

export abstract class IsolatedBundlerBuild {
  readonly warnings: string[] = [];
  readonly outDir: string;
  protected readonly baseDir: string;

  protected constructor(bundlerName: string, protected readonly fixtureDir: string, label: string) {
    const id = `${label}-${randomBytes(4).toString('hex')}`;
    this.baseDir = join(fixtureDir, '.tmp-test', `${bundlerName}-build`, id);
    this.outDir  = join(this.baseDir, 'dist');
  }

  /** Absolute path to the bundler's hashed-asset output directory. */
  get assets(): string {
    return join(this.outDir, 'assets');
  }

  abstract build(options: DotnetAssetsOptions): Promise<void>;

  cleanup(): void {
    rmSync(this.baseDir, { recursive: true, force: true });
  }
}

export class IsolatedViteBuild extends IsolatedBundlerBuild {
  private readonly cacheDir: string;

  constructor(fixtureDir: string, label: string) {
    super('vite', fixtureDir, label);
    this.cacheDir = join(this.baseDir, '.vite');
  }

  async build(
    pluginOptions: DotnetAssetsOptions,
    extra: InlineConfig = {},
  ): Promise<void> {
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
      plugins: [DotnetAssets(pluginOptions)],
      ...extra,
      build: {
        outDir: this.outDir,
        rollupOptions: { input: resolve(this.fixtureDir, 'index.html') },
        ...extra.build,
      },
    });
  }
}
