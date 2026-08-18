import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import DotnetWasm from 'unplugin-dotnet-wasm/rsbuild';
import { resolve } from 'node:path';

export default defineConfig(({ envMode }) => {
  const isRelease = envMode === 'production';
  return {
    html: {
      template: './index.html',
    },
    source: {
      entry: { index: resolve(import.meta.dirname, 'src/main.tsx') },
    },
    output: {
      distPath: { root: resolve(import.meta.dirname, 'dist') },
    },
    plugins: [
      pluginReact(),
      DotnetWasm({
        projectRoot: resolve(import.meta.dirname, '../../libraries/BlazorElements'),
        projectName: 'BlazorElements',
        configuration: isRelease ? 'Release' : 'Debug',
        isPublish: isRelease,
        targetFramework: 'net10.0',
        logLevel: 'info',
      }),
    ],
  };
});
