// Run under Bun:  bun bun.build.ts
import DotnetAssets from 'unplugin-dotnet-static-assets/bun';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFileSync, mkdirSync } from 'node:fs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const outdir = resolve(__dirname, 'dist');

const result = await Bun.build({
  entrypoints: [resolve(__dirname, 'src/entry.ts')],
  outdir,
  target: 'browser',
  format: 'esm',
  minify: false,
  naming: {
    entry: '[name].[ext]',
    asset: '[name]-[hash].[ext]',
  },
  loader: {
    '.wasm': 'file',
    '.dat': 'file',
    '.pdb': 'file',
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

if (!result.success) {
  console.error('Build failed:', result.logs);
  process.exit(1);
}

mkdirSync(outdir, { recursive: true });
copyFileSync(resolve(__dirname, 'src/index.html'), resolve(outdir, 'index.html'));
