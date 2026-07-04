import * as esbuild from 'esbuild';
import DotnetAssets from 'unplugin-dotnet-static-assets/esbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const outdir = resolve(__dirname, 'dist');

const emitHtml = {
  name: 'emit-html',
  setup(build) {
    build.onEnd(() => {
      writeFileSync(
        resolve(build.initialOptions.outdir, 'index.html'),
        readFileSync(new URL('./src/index.html', import.meta.url), 'utf-8'),
      );
    });
  },
};

await esbuild.build({
  entryPoints: [resolve(__dirname, 'src/entry.ts')],
  outdir,
  bundle: true,
  format: 'esm',
  // 'browser' platform lets esbuild generate new URL(..., import.meta.url) for file-loader
  // assets, so the hashed wasm/dat paths resolve correctly relative to entry.js rather than
  // the document root. Node built-ins (module, process, etc.) are handled by the plugin.
  platform: 'browser',
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
    emitHtml,
  ],
});
