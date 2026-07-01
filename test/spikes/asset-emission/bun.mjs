// Run under Bun:  bun bun.mjs
import { REAL_WASM, VIRTUAL_SPECIFIER } from './plugin.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

const result = await Bun.build({
  entrypoints: [resolve(HERE, 'src/entry.mjs')],
  outdir: resolve(HERE, 'dist-bun'),
  target: 'browser',
  format: 'esm',
  minify: false,
  naming: {
    entry: 'entry.js',
    asset: 'assets/[name]-[hash].[ext]',
  },
  loader: { '.wasm': 'file' },
  plugins: [
    {
      name: 'spike-asset-emission-bun',
      setup(build) {
        build.onResolve({ filter: new RegExp(`^${VIRTUAL_SPECIFIER}$`) }, () => ({
          path: REAL_WASM,
        }));
      },
    },
  ],
});

if (!result.success) {
  console.error(result.logs);
  process.exit(1);
}
