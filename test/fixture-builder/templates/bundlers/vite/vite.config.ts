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

const plugins = [
  DotnetWasm({
    projectRoot,
    projectName: 'Library',
    configuration,
    isPublish,
    targetFramework: 'net10.0',
    logLevel: 'info',
  }),
  rollupSentinelPlugin(),
];

const server = {
  watch: {
    ignored: (watchedPath: string) => {
      // safety-net: ignore files outside project root, let plugin handle it.
      return !watchedPath.replace(/\\/g, '/').startsWith(projectRoot.replace(/\\/g, '/'));
    },
  },
};

const nodeEntry = {
  input: resolve(__dirname, 'src/entry.ts'),
  preserveEntrySignatures: 'strict' as const,
  output: { format: 'es' as const, entryFileNames: 'entry.js' },
};

export default defineConfig(
  platform === 'node'
    ? {
        plugins,
        server,
        // Vite's client environment is always present; build only the Node one.
        environments: {
          node: {
            consumer: 'server',
            build: {
              outDir: 'dist',
              emitAssets: true,
              rolldownOptions: nodeEntry,
            },
          },
        },
        builder: {
          buildApp: async (builder) => {
            const node = builder.environments.node;
            if (!node) throw new Error('Vite "node" environment was not created.');
            await builder.build(node);
          },
        },
      }
    : {
        plugins,
        server,
        build: {
          outDir: 'dist',
          rollupOptions: {
            input: resolve(__dirname, 'index.html'),
          },
        },
      },
);
