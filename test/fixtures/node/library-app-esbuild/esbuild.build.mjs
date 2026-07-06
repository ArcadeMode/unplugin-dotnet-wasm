import * as esbuild from 'esbuild';
import DotnetAssets from 'unplugin-dotnet-wasm/esbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const outdir = resolve(__dirname, 'dist');

await esbuild.build({
  entryPoints: [resolve(__dirname, 'src/entry.ts')],
  outdir,
  bundle: true,
  format: 'esm',
  // 'node' platform: esbuild handles Node built-ins natively, generates file:// URLs for assets.
  // The plugin resolves .wasm/.dat assets to file paths that work in Node context.
  platform: 'node',
  entryNames: 'entry',
  assetNames: 'assets/[name]-[hash]',
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

