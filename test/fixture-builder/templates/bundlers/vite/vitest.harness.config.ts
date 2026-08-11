import { defineConfig } from 'vitest/config';
import DotnetWasm from 'unplugin-dotnet-wasm/vite';

const projectRoot = process.env.DOTNET_PROJECT_ROOT;
if (!projectRoot) {
  throw new Error('DOTNET_PROJECT_ROOT env var is required (set by the fixture-builder).');
}
const projectName = process.env.DOTNET_PROJECT_NAME;
if (!projectName) {
  throw new Error('DOTNET_PROJECT_NAME env var is required (set by the fixture-builder).');
}
const configuration = (process.env.DOTNET_CONFIGURATION ?? 'Debug') as 'Debug' | 'Release';
const isPublish = process.env.DOTNET_IS_PUBLISH === 'true';

export default defineConfig({
  plugins: [
    DotnetWasm({
      projectRoot,
      projectName,
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
    // Nested vitest is asserted by the outer e2e suite via captured stdout.
    disableConsoleIntercept: true,
  },
});
