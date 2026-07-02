import * as esbuild from 'esbuild';
import DotnetAssets from 'unplugin-dotnet-static-assets/esbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

await esbuild.build({
  entryPoints: [resolve(__dirname, 'src/entry.ts')],
  outdir: resolve(__dirname, 'dist'),
  bundle: true,
  format: 'esm',
  // 'neutral' lets dotnet.js's Node.js-guarded import statements pass through
  // as external without error; the browser-specific code paths execute at
  // runtime because the .NET loader guards all Node.js calls with typeof checks.
  platform: 'neutral',
  entryNames: 'assets/[name]-[hash]',
  assetNames: 'assets/[name]-[hash]',
  loader: {
    '.wasm': 'file',
    '.dat': 'file',
    '.pdb': 'file',
  },
  plugins: [
    DotnetAssets({
      projectRoot: resolve(__dirname, '../Library'),
      projectName: 'Library',
      configuration: 'Debug',
      targetFramework: 'net10.0',
      logLevel: 'info',
    }),
  ],
});
