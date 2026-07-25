import { defineConfig } from '@farmfe/core';
import DotnetAssets from 'unplugin-dotnet-wasm/farm';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(() => {
  const isRelease = process.env.DOTNET_RELEASE === '1';
  return {
    compilation: {
      input: { entry: resolve(__dirname, 'src/entry.ts') },
      output: {
        path: resolve(__dirname, 'dist'),
        entryFilename: '[entryName].js',
        filename: 'assets/[name].[hash].[ext]',
        assetsFilename: 'assets/[resourceName].[hash].[ext]',
        // `node-next` targets latest Node and skips Farm's polyfill injection
        targetEnv: 'node-next' as const,
        format: 'esm' as const,
      },
      assets: {
        // Binary .NET assets (.wasm, .dat, .pdb) must be declared here so Farm
        // treats files with these extensions as emittable static assets rather
        // than attempting to parse them as JavaScript modules.
        include: ['wasm', 'dat', 'pdb'],
        // Node target defaults asset mode to 'node', which emits fileURLToPath(...) OS paths;
        // the dotnet runtime fetch()es asset URLs, so force 'browser' mode to get a URL instead.
        mode: 'browser',
      },
      partialBundling: {
        // Force every module into a single resource so the dotnet runtime isn't
        // split into orphaned chunks that never get loaded on Node.
        enforceResources: [{ name: 'entry', test: ['.+'] }],
      },
      minify: false,
      persistentCache: false,
      progress: false,
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
