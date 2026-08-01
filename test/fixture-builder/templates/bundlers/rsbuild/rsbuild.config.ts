import { defineConfig } from '@rsbuild/core';
import DotnetWasm from 'unplugin-dotnet-wasm/rsbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const projectRoot = process.env.DOTNET_PROJECT_ROOT;
if (!projectRoot) {
  throw new Error('DOTNET_PROJECT_ROOT env var is required (set by the fixture-builder).');
}
const configuration = (process.env.DOTNET_CONFIGURATION ?? 'Debug') as 'Debug' | 'Release';
const isPublish = process.env.DOTNET_IS_PUBLISH === 'true';
const platform = process.env.DOTNET_FIXTURE_PLATFORM === 'node' ? 'node' : 'browser';

export default defineConfig(() => {
  const plugins = [
    DotnetWasm({
      projectRoot,
      projectName: 'Library',
      configuration,
      isPublish,
      targetFramework: 'net10.0',
      logLevel: 'info',
    }),
  ];

  // E2E artifact assertions expect hashed binaries under `dist/assets/` (not
  // rsbuild's default `static/assets` / `static/wasm`).
  const distPath = {
    root: resolve(__dirname, 'dist'),
    assets: 'assets',
    wasm: 'assets',
  };

  if (platform === 'node') {
    return {
      source: {
        entry: { entry: resolve(__dirname, 'src/entry.ts') },
      },
      output: {
        target: 'node',
        distPath: { ...distPath, js: '' },
        filenameHash: false,
        minify: false,
      },
      tools: {
        // rsbuild's node target defaults to a non-ESM chunk format; force ESM
        // module output plus publicPath 'auto' so asset URLs get an
        // import.meta.url base.
        rspack: (config) => {
          config.experiments = { ...config.experiments, outputModule: true };
          config.output = {
            ...config.output,
            module: true,
            chunkFormat: 'module',
            library: { type: 'module' },
            publicPath: 'auto',
            assetModuleFilename: 'assets/[name]-[contenthash][ext]',
          };
          return config;
        },
      },
      plugins,
    };
  }

  return {
    source: {
      entry: { index: resolve(__dirname, 'src/entry.ts') },
    },
    output: {
      distPath,
      filenameHash: true,
      minify: false,
    },
    plugins,
  };
});
