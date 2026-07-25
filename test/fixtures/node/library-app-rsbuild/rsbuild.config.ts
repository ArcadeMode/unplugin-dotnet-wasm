import { defineConfig } from '@rsbuild/core';
import DotnetWasm from 'unplugin-dotnet-wasm/rsbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ envMode }) => {
  const isRelease = envMode === 'production';
  return {
    source: {
      entry: { entry: resolve(__dirname, 'src/entry.ts') },
    },
    output: {
      target: 'node',
      distPath: { root: resolve(__dirname, 'dist'), js: '' },
      filenameHash: false,
      minify: false,
    },
    tools: {
      // rsbuild's node target defaults to a non-ESM chunk format; force ESM module output
      // (matching every other node fixture) plus publicPath 'auto' so asset URLs get an
      // import.meta.url base (same rspack divergence as the standalone rspack fixture).
      rspack: (config) => {
        config.experiments = { ...config.experiments, outputModule: true };
        config.output = {
          ...config.output,
          module: true,
          chunkFormat: 'module',
          library: { type: 'module' },
          publicPath: 'auto',
        };
        return config;
      },
    },
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
  };
});
