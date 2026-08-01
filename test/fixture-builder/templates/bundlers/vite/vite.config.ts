import { defineConfig } from 'vite';
import DotnetWasm from 'unplugin-dotnet-wasm/vite';
import { resolve } from 'node:path';

const projectRoot = process.env.DOTNET_PROJECT_ROOT;
if (!projectRoot) {
  throw new Error('DOTNET_PROJECT_ROOT env var is required (set by the fixture-builder).');
}
const configuration = (process.env.DOTNET_CONFIGURATION ?? 'Debug') as 'Debug' | 'Release';
const isPublish = process.env.DOTNET_IS_PUBLISH === 'true';

// The isolated Library copy lives inside the project root, so its churning
// bin/obj build output (e.g. obj/.../tmp-webcil/*.wasm) would otherwise be
// picked up by vite's recursive dev-server watcher. On Windows a mid-run
// `dotnet build` locks those transient files and vite's chokidar watcher
// throws an uncaught EBUSY that kills the dev server. Exclude the whole
// Library dir — the plugin's own ManifestWatcher drives reloads.
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
  ],
  server: {
    watch: {
      ignored: (watchedPath: string) =>
        watchedPath.replace(/\\/g, '/').startsWith(normalizedLibrary),
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },
});
