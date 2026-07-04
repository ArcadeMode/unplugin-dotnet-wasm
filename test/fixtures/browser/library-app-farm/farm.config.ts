import { defineConfig } from '@farmfe/core';
import DotnetAssets from 'unplugin-dotnet-static-assets/farm';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  compilation: {
    input: { index: resolve(__dirname, 'index.html') },
    output: {
      path: resolve(__dirname, 'dist'),
      filename: 'assets/[name].[hash].[ext]',
      assetsFilename: 'assets/[resourceName].[hash].[ext]',
      publicPath: '/',
      // The dotnet WASM runtime requires modern browsers; targeting
      // `browser-esnext` disables Farm's polyfill injection (which
      // otherwise requires `core-js` to be installed).
      targetEnv: 'browser-esnext',
    },
    assets: {
      // Binary .NET assets (.wasm, .dat, .pdb) must be declared here so Farm
      // treats files with these extensions as emittable static assets rather
      // than attempting to parse them as JavaScript modules.
      include: ['wasm', 'dat', 'pdb'],
    },
    minify: false,
    persistentCache: false,
    progress: false,
  },
  server: { hmr: false },
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
