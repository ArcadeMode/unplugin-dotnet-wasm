import * as esbuild from 'esbuild';
import DotnetAssets from 'unplugin-dotnet-static-assets/esbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const outdir = resolve(__dirname, 'dist');

await esbuild.build({
  entryPoints: [resolve(__dirname, 'src/entry.ts')],
  outdir,
  bundle: true,
  format: 'esm',
  // 'neutral' lets dotnet.js's Node.js-guarded import statements pass through
  // as external without error; the browser-specific code paths execute at
  // runtime because the .NET loader guards all Node.js calls with typeof checks.
  platform: 'neutral',
  entryNames: 'assets/entry',
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

writeFileSync(
  resolve(outdir, 'index.html'),
  `<!DOCTYPE html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>Library — esbuild</title></head>
  <body>
    <p>Open DevTools console — <code>window.__lib</code> and <code>window.__libReady</code> are set on boot.</p>
    <script type="module" src="./assets/entry.js"></script>
  </body>
</html>`,
);
