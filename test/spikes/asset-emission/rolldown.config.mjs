import { spikePlugin } from './plugin.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

export default {
  input: resolve(HERE, 'src/entry.mjs'),
  output: {
    dir: resolve(HERE, 'dist-rolldown'),
    format: 'esm',
    entryFileNames: 'entry.js',
    assetFileNames: 'assets/[name]-[hash][extname]',
  },
  plugins: [spikePlugin.rolldown()],
};
