// NOTE: import defineConfig from 'vite' (this fixture has vite but NOT vitest/config).
import { defineConfig } from 'vite';
import DotnetAssets from 'unplugin-dotnet-wasm/vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: __dirname,
  plugins: [
    DotnetAssets({
      projectRoot: resolve(__dirname, '../../Library'),
      projectName: 'Library',
      configuration: 'Debug',
      isPublish: false,
      targetFramework: 'net10.0',
      logLevel: 'info',
    }),
  ],
  // Vitest reads this `test` field from the Vite config.
  test: {
    include: ['runtime.harness.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
} as Parameters<typeof defineConfig>[0]);
