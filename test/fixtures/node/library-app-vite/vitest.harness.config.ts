import { defineConfig } from 'vitest/config';
import DotnetWasm from 'unplugin-dotnet-wasm/vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => {
  const isRelease = mode === 'production';
  return {
    root: __dirname,
    plugins: [
      DotnetWasm({
        projectRoot: resolve(__dirname, '../../Library'),
        projectName: 'Library',
        configuration: isRelease ? 'Release' : 'Debug',
        isPublish: isRelease,
        targetFramework: 'net10.0',
        logLevel: 'info',
      }),
    ],
    test: {
      include: ['runtime.harness.test.ts'],
      environment: 'node',
      testTimeout: 60_000,
    },
  };
});
