import { defineConfig } from '@farmfe/core';
import farmPostcss from '@farmfe/js-plugin-postcss';
import react from '@farmfe/plugin-react';
import DotnetWasm from 'unplugin-dotnet-wasm/farm';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);
// Farm + pnpm cannot follow React's package exports; alias to the real package dirs.
const reactDir = dirname(require.resolve('react/package.json'));
const reactDomDir = dirname(require.resolve('react-dom/package.json'));
const schedulerDir = dirname(require.resolve('scheduler/package.json', { paths: [reactDomDir] }));
const reactRefreshDir = dirname(require.resolve('react-refresh/package.json'));

export default defineConfig(() => {
  const isRelease = process.env.DOTNET_RELEASE === '1';
  return {
    compilation: {
      input: { index: resolve(__dirname, 'index.html') },
      output: {
        path: resolve(__dirname, 'dist'),
        filename: 'assets/[name].[hash].[ext]',
        assetsFilename: 'assets/[resourceName].[hash].[ext]',
        publicPath: '/',
        // `browser-esnext` disables Farm's polyfill injection
        targetEnv: 'browser-esnext' as const,
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
      resolve: {
        alias: {
          'react-dom/client': resolve(reactDomDir, 'client.js'),
          'react-dom': reactDomDir,
          'react/jsx-dev-runtime': resolve(reactDir, 'jsx-dev-runtime.js'),
          'react/jsx-runtime': resolve(reactDir, 'jsx-runtime.js'),
          'react-refresh/runtime': resolve(reactRefreshDir, 'runtime.js'),
          'react-refresh': reactRefreshDir,
          react: reactDir,
          scheduler: schedulerDir,
        },
      },
    },
    server: { port: 5176, strictPort: true },
    plugins: [
      react({ runtime: 'automatic' }),
      // Farm does not run postcss.config.mjs on its own; Tailwind v4 needs this plugin.
      farmPostcss(),
      DotnetWasm({
        projectRoot: resolve(__dirname, '../../libraries/WasmLibrary'),
        projectName: 'WasmLibrary',
        configuration: isRelease ? 'Release' : 'Debug',
        isPublish: isRelease,
        targetFramework: 'net10.0',
        logLevel: 'info',
      }),
    ],
  };
});
