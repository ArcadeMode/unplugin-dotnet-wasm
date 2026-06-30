import { build as viteBuild, createLogger, type InlineConfig } from 'vite';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import DotnetAssets from 'unplugin-dotnet-static-assets/vite';
import type { DotnetAssetsOptions } from 'unplugin-dotnet-static-assets';

// ---------------------------------------------------------------------------
// Bundler-agnostic base. Reserves the shape integration tests assert against;
// only the Vite implementation exists today. Webpack/Rspack/Rollup adapters
// will subclass when the matching plugin adapters land.
// ---------------------------------------------------------------------------

export abstract class IsolatedBundlerBuild {
  readonly warnings: string[] = [];
  readonly outDir: string;
  protected readonly baseDir: string;

  protected constructor(toolName: string, label: string) {
    const id = `${label}-${randomBytes(4).toString('hex')}`;
    this.baseDir = join(tmpdir(), `dotnet-${toolName}-smoke`, id);
    this.outDir  = join(this.baseDir, 'dist');
  }

  /** Absolute path to the bundler's hashed-asset output directory. */
  get assets(): string {
    return join(this.outDir, 'assets');
  }

  abstract build(fixtureDir: string, options: DotnetAssetsOptions): Promise<void>;

  cleanup(): void {
    rmSync(this.baseDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Vite implementation
// ---------------------------------------------------------------------------

export class IsolatedViteBuild extends IsolatedBundlerBuild {
  private readonly cacheDir: string;

  constructor(label = 'smoke') {
    super('vite', label);
    this.cacheDir = join(this.baseDir, '.vite');
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
}
