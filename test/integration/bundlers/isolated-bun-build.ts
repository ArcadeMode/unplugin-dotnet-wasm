import { join } from 'node:path';
import { execSync } from 'node:child_process';
import type { DotnetAssetsOptions } from 'unplugin-dotnet-wasm';
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
import DotnetAssets from 'unplugin-dotnet-wasm/bun';
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
    
    // Spawn Bun subprocess to execute the build.
    // stderr is piped (not inherited) so we can extract the real DiscoveryError message
    // from the output and rethrow it, allowing callers to assert on the message.
    try {
      execSync(`bun run -`, { 
        input: buildScript,
        stdio: ['pipe', 'inherit', 'pipe'],
        cwd: this.fixtureDir,
      });
    } catch (err: any) {
      // Bun build failed; write captured stderr back to the parent process for visibility.
      const stderrOutput: string = err.stderr?.toString() ?? '';
      if (stderrOutput) process.stderr.write(stderrOutput);
      if (stderrOutput) this.warnings.push(stderrOutput);

      // The build script prints "Error: <message>" to stderr; extract it so the
      // DiscoveryError message is preserved rather than the generic execSync message.
      const PREFIX = 'Endpoints manifest not found at';
      const idx = stderrOutput.indexOf(PREFIX);
      if (idx !== -1) {
        const rest = stderrOutput.slice(idx + PREFIX.length).trim();
        const path = rest.split(/\r?\n/)[0].trim();
        throw new Error(`${PREFIX} ${path}`);
      }
      throw err;
    }
  }
}


