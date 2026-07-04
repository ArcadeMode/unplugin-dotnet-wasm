import { defineConfig } from '@rsbuild/core';
import DotnetAssets from 'unplugin-dotnet-static-assets/rsbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
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
  plugins: [
    DotnetAssets({
      projectRoot: resolve(__dirname, '../../Library'),
      projectName: 'Library',
      configuration: 'Debug',
      targetFramework: 'net10.0',
      logLevel: 'info',
    }),
  ],
});
