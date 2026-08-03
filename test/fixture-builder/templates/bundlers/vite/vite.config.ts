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

// The isolated Library is an out-of-tree sibling of this app (../Library), so
// vite's recursive dev-server watcher does not scan it. This guard is kept as
// defense-in-depth: if the plugin ever pulls a physical Library/bin|obj asset
// into the module graph, vite could try to watch the churning build output and
// (on Windows) a mid-run `dotnet build` file lock throws an uncaught EBUSY that
// kills the dev server. The plugin's own ManifestWatcher drives reloads.
const normalizedLibrary = projectRoot.replace(/\\/g, '/');

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
      ignored: (watchedPath: string) =>
        watchedPath.replace(/\\/g, '/').startsWith(normalizedLibrary),
    },
  },
  build: {
    outDir: 'dist',
    // Node: bundle the entry to a runnable `dist/entry.js`. Browser: emit from
    // the HTML document.
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
