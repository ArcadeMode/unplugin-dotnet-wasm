import { defineConfig } from '@farmfe/core';
import vue from '@vitejs/plugin-vue';
import DotnetWasm from 'unplugin-dotnet-wasm/farm';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);
// Farm + pnpm cannot follow Vue's nested @vue/* imports; the browser ESM build is self-contained.
const vueEntry = resolve(require.resolve('vue/package.json'), '../dist/vue.runtime.esm-browser.js');

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
      define: {
        __VUE_OPTIONS_API__: 'true',
        __VUE_PROD_DEVTOOLS__: 'false',
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
      },
      resolve: {
        alias: { vue: vueEntry },
      },
    },
    server: { port: 5176, strictPort: true },
    plugins: [
      DotnetWasm({
        projectRoot: resolve(__dirname, '../../libraries/WasmLibrary'),
        projectName: 'WasmLibrary',
        configuration: isRelease ? 'Release' : 'Debug',
        isPublish: isRelease,
        targetFramework: 'net10.0',
        logLevel: 'info',
      }),
    ],
    vitePlugins: [vue()], // @vitejs/plugin-vue 6+ uses a hook Farm 1 does not support
  };
});
