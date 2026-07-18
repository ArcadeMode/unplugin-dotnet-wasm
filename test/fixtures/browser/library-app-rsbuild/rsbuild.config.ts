import { defineConfig } from '@rsbuild/core';
import DotnetAssets from 'unplugin-dotnet-wasm/rsbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ envMode }) => {
  const isRelease = envMode === 'production';
  return {
    html: {
      template: './src/index.html',
    },
    source: {
      entry: { index: resolve(__dirname, 'src/entry.ts') },
    },
    output: {
      distPath: { root: resolve(__dirname, 'dist') },
      filenameHash: true,
      minify: false,
    },
    server: {
      port: 5174,
    },
    plugins: [
      DotnetAssets({
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
