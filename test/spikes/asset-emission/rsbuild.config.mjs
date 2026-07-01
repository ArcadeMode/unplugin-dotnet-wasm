import { spikePlugin } from './plugin.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

export default {
  source: {
    entry: {
      main: resolve(HERE, 'src/entry.mjs'),
    },
  },
  output: {
    distPath: {
      root: resolve(HERE, 'dist-rsbuild'),
    },
    minify: false,
    filename: {
      js: 'main.js',
    },
    filenameHash: true,
    assetPrefix: '',
  },
  plugins: [spikePlugin.rsbuild()],
};
