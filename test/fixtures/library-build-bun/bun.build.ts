// Run under Bun:  bun bun.build.ts
import DotnetAssets from 'unplugin-dotnet-static-assets/bun';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const result = await Bun.build({
  entrypoints: [resolve(__dirname, 'src/entry.ts')],
  outdir: resolve(__dirname, 'dist'),
  target: 'browser',
  format: 'esm',
  minify: false,
  naming: {
    entry: 'assets/[name]-[hash].[ext]',
    asset: 'assets/[name]-[hash].[ext]',
  },
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

if (!result.success) {
  console.error('Build failed:', result.logs);
  process.exit(1);
}
