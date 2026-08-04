import { defineConfig } from 'vitest/config';
import DotnetWasm from 'unplugin-dotnet-wasm/vite';

const projectRoot = process.env.DOTNET_PROJECT_ROOT;
if (!projectRoot) {
  throw new Error('DOTNET_PROJECT_ROOT env var is required (set by the fixture-builder).');
}
const configuration = (process.env.DOTNET_CONFIGURATION ?? 'Debug') as 'Debug' | 'Release';
const isPublish = process.env.DOTNET_IS_PUBLISH === 'true';

export default defineConfig({
  plugins: [
    DotnetWasm({
      projectRoot,
      projectName: 'Library',
      configuration,
      isPublish,
      targetFramework: 'net10.0',
      logLevel: 'info',
    }),
  ],
  test: {
    include: ['runtime.harness.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
