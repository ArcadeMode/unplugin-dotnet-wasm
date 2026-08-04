import { defineConfig } from 'vite';
import DotnetWasm from 'unplugin-dotnet-wasm/vite';
import { resolve } from 'node:path';
// @ts-expect-error - sibling .mjs helper materialized next to this config
import { rollupSentinelPlugin } from './sentinel.mjs';

const projectRoot = process.env.DOTNET_PROJECT_ROOT;
if (!projectRoot) {
  throw new Error('DOTNET_PROJECT_ROOT env var is required (set by the fixture-builder).');
}
const configuration = (process.env.DOTNET_CONFIGURATION ?? 'Debug') as 'Debug' | 'Release';
const isPublish = process.env.DOTNET_IS_PUBLISH === 'true';
const platform = process.env.DOTNET_FIXTURE_PLATFORM === 'node' ? 'node' : 'browser';

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
    rollupSentinelPlugin(),
  ],
  server: {
    watch: {
      ignored: (watchedPath: string) => {
        // safety-net: ignore files outside project root, let plugin handle it.
        return !watchedPath.replace(/\\/g, '/').startsWith(projectRoot.replace(/\\/g, '/'));
      },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions:
      platform === 'node'
        ? {
            input: resolve(__dirname, 'src/entry.ts'),
            preserveEntrySignatures: 'strict',
            output: { format: 'es', entryFileNames: 'entry.js' },
          }
        : {
            input: resolve(__dirname, 'index.html'),
          },
  },
});
