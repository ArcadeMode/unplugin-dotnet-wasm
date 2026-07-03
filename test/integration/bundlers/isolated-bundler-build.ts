import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { rmSync } from 'node:fs';
import type { DotnetAssetsOptions } from 'unplugin-dotnet-static-assets';

// dotnet.js has bare `import('module')` / `import('process')` fallback paths
// that only fire under Node. Some rollup-family drivers need these marked as
// external so the bundler doesn't warn about unresolved bare imports.
export const DOTNET_NODE_BUILTINS = new Set(['module', 'process', 'fs', 'path', 'url', 'worker_threads']);

export abstract class IsolatedBundlerBuild {
  readonly warnings: string[] = [];
  readonly outDir: string;
  protected readonly baseDir: string;

  protected constructor(bundlerName: string, protected readonly fixtureDir: string, label: string) {
    const id = `${label}-${randomBytes(4).toString('hex')}`;
    this.baseDir = join(fixtureDir, '.tmp-test', `${bundlerName}-build`, id);
    this.outDir  = join(this.baseDir, 'dist');
  }

  /** Directory containing the hashed asset outputs (`.wasm`, `.dat`, …). */
  get assets(): string {
    return join(this.outDir, 'assets');
  }

  /** Absolute path to the built entry chunk. Driver-specific. */
  abstract get entryChunk(): string;

  abstract build(options: DotnetAssetsOptions): Promise<void>;

  cleanup(): void {
    rmSync(this.baseDir, { recursive: true, force: true });
  }

  protected entryPoint(): string {
    return resolve(this.fixtureDir, 'src/entry.ts');
  }
}
