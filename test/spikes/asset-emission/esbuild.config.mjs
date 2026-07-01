import { spikePlugin } from './plugin.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

export default {
  entryPoints: [resolve(HERE, 'src/entry.mjs')],
  outdir: resolve(HERE, 'dist-esbuild'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  loader: { '.wasm': 'file' },
  assetNames: 'assets/[name]-[hash]',
  entryNames: 'entry',
  plugins: [spikePlugin.esbuild()],
};
