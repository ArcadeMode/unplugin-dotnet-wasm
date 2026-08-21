import * as esbuild from 'esbuild';
import DotnetWasm from 'unplugin-dotnet-wasm/esbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const libraryOut = resolve(__dirname, '../../libraries/WasmLibrary/bin/Debug/net10.0');

await esbuild.build({
  entryPoints: [resolve(__dirname, 'src/entry.ts')],
  outdir: resolve(__dirname, 'dist'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  entryNames: 'entry',
  assetNames: 'assets/[name]-[hash]',
  plugins: [
    DotnetWasm({
      projectName: 'WasmLibrary',
      dotnetOutputDir: libraryOut, // demo the ability to specify a custom output dir
      logLevel: 'info',
    }),
  ],
});
