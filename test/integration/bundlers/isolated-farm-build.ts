import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import type { DotnetAssetsOptions } from 'unplugin-dotnet-wasm';
import type { Platform } from '../test-matrix.js';
import { IsolatedBundlerBuild } from './isolated-bundler-build.js';

export class IsolatedFarmBuild extends IsolatedBundlerBuild {
  constructor(fixtureDir: string, platform: Platform, label: string) { super('farm', fixtureDir, platform, label); }
  get entryChunk(): string {
    // Both platforms use hashed output; find index chunk.
    const files = readdirSync(this.assets);
    const entry = files.find(f => /^index[._-].+\.js$/.test(f));
    if (!entry) throw new Error(`Farm entry chunk not found under ${this.assets}`);
    return join(this.assets, entry);
  }

  async build(pluginOptions: DotnetAssetsOptions): Promise<void> {
    this.warnings.length = 0;

    // Farm's native Rust core writes to fd 2 directly (bypassing process.stderr.write) and
    // calls process.exit(1) on plugin errors. Run the build in a Node subprocess so that
    // process.exit terminates only the child and stderr can be captured via a real pipe.
    const buildScript = `
import { build } from '@farmfe/core';
import DotnetAssets from 'unplugin-dotnet-wasm/farm';

const config = JSON.parse(process.env.FARM_BUILD_CONFIG);
const targetEnv = config.platform === 'node' ? 'node-next' : 'browser-esnext';

await build({
  root: config.fixtureDir,
  compilation: {
    input: { index: config.entryPoint },
    output: {
      path: config.outDir,
      filename: 'assets/[name].[hash].[ext]',
      assetsFilename: 'assets/[name].[hash].[ext]',
      publicPath: '/',
      targetEnv,
    },
    assets: { include: ['wasm', 'dat', 'pdb'] },
    minify: false,
    persistentCache: false,
    progress: false,
  },
  server: { hmr: false },
  plugins: [DotnetAssets(config.pluginOptions)],
});
`;

    const configEnv = JSON.stringify({
      fixtureDir: this.fixtureDir,
      outDir: this.outDir,
      entryPoint: this.entryPoint(),
      platform: this.platform,
      pluginOptions,
    });

    try {
      execSync('node --input-type=module', {
        input: buildScript,
        stdio: ['pipe', 'inherit', 'pipe'],
        cwd: this.fixtureDir,
        env: { ...process.env, FARM_BUILD_CONFIG: configEnv },
      });
    } catch (err: any) {
      // Write captured stderr back to the parent process for visibility.
      const stderrOutput: string = err.stderr?.toString() ?? '';
      if (stderrOutput) process.stderr.write(stderrOutput);
      if (stderrOutput) this.warnings.push(stderrOutput);

      // Extract the real DiscoveryError message from Farm's stderr output and rethrow
      // so callers can assert on the message (e.g. in publish.test.ts).
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

