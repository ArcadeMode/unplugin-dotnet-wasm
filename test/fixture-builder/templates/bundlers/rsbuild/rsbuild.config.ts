import { defineConfig } from '@rsbuild/core';
import DotnetWasm from 'unplugin-dotnet-wasm/rsbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error - sibling .mjs helper materialized next to this config
import { touchSentinel } from './sentinel.mjs';

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
    {
      name: 'test-sentinel',
      setup(api) {
        api.onAfterBuild(() => touchSentinel());
        api.onAfterDevCompile(() => touchSentinel());
      },
    },
  ];

  const distPath = {
    root: resolve(__dirname, 'dist'),
    js: 'assets',
    jsAsync: 'assets',
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
