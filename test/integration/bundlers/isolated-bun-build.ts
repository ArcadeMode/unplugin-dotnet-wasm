import { join } from 'node:path';
import { execSync } from 'node:child_process';
import type { DotnetAssetsOptions } from 'unplugin-dotnet-static-assets';
import type { Platform } from '../test-matrix.js';
import { IsolatedBundlerBuild } from './isolated-bundler-build.js';

export class IsolatedBunBuild extends IsolatedBundlerBuild {
  constructor(fixtureDir: string, platform: Platform, label: string) {
    if (platform !== 'browser') {
      throw new Error(`bun does not support platform='${platform}'. Supported: browser.`);
    }
    super('bun', fixtureDir, platform, label);
  }
  get entryChunk(): string { return join(this.assets, 'entry.js'); }

  async build(pluginOptions: DotnetAssetsOptions): Promise<void> {
    this.warnings.length = 0;
    
    // Create a temporary build script that Bun will execute
    const buildScript = `
import DotnetAssets from 'unplugin-dotnet-static-assets/bun';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const pluginOptions = ${JSON.stringify(pluginOptions)};

try {
  const result = await Bun.build({
    entrypoints: ['${this.entryPoint().replace(/\\/g, '\\\\')}'],
    outdir: '${this.outDir.replace(/\\/g, '\\\\')}',
    target: 'browser',
    format: 'esm',
    minify: false,
    naming: {
      entry: 'assets/[name].[ext]',
      asset: 'assets/[name]-[hash].[ext]',
    },
    loader: {
      '.wasm': 'file',
      '.dat': 'file',
      '.pdb': 'file',
    },
    plugins: [DotnetAssets(pluginOptions)],
  });

  if (!result.success) {
    console.error('Bun build failed');
    for (const log of result.logs) {
      console.error('[' + log.level + '] ' + log.message);
    }
    process.exit(1);
  }
} catch (error) {
  console.error('Error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
}
`;
    
    // Spawn Bun subprocess to execute the build
    try {
      execSync(`bun run -`, { 
        input: buildScript,
        stdio: ['pipe', 'inherit', 'inherit'],
        cwd: this.fixtureDir,
      });
    } catch (err: any) {
      // Bun build failed
      if (err.stdout) {
        this.warnings.push(err.stdout.toString());
      }
      if (err.stderr) {
        this.warnings.push(err.stderr.toString());
      }
      throw err;
    }
  }
}

