import { describe, test, expect } from 'vitest';
import { createServer } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import DotnetAssets from 'unplugin-dotnet-wasm/vite';
import { readBundler, readBuildMode, readPlatform, readServeMode } from '../test-matrix-parameters';

const bundler = readBundler();
const platform = readPlatform();
const serveMode = readServeMode();
const buildMode = readBuildMode();

const __dirname = resolve(fileURLToPath(import.meta.url), '..');

// Only vite node + server is wired today.
const skip =
  platform !== 'node' || serveMode !== 'server' || buildMode === 'none' || bundler !== 'vite';

describe(`[${bundler}][node][server] Vite dev-server WASM runtime interop`, { skip }, () => {
  test('boots .NET WASM under a Vite dev server (SSR) and runs interop', async () => {
    const fixtureDir = resolve(__dirname, '../../fixtures/node/library-app-vite');
    const server = await createServer({
      root: fixtureDir,
      configFile: false,
      logLevel: 'error',
      server: { middlewareMode: true, hmr: false },
      plugins: [
        DotnetAssets({
          projectRoot: resolve(fixtureDir, '../../Library'),
          projectName: 'Library',
          configuration: buildMode === 'publish' ? 'Release' : 'Debug',
          isPublish: buildMode === 'publish',
          targetFramework: 'net10.0',
          logLevel: 'warn',
        }),
      ],
    });

    try {
      const mod = await server.ssrLoadModule('/runtime-serve-runner.ts');
      const run = mod.run as () => Promise<string>;
      const result = await run();
      expect(result).toBe('SUCCESS');
    } finally {
      await server.close();
    }
  }, 60_000);
});
