import { spikePlugin } from './plugin.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

export default {
  compilation: {
    input: {
      entry: resolve(HERE, 'src/entry.mjs'),
    },
    output: {
      path: resolve(HERE, 'dist-farm'),
      filename: 'entry.js',
      assetsFilename: 'assets/[resourceName].[hash].[ext]',
      publicPath: '/',
      targetEnv: 'browser',
    },
    minify: false,
    assets: {
      include: ['wasm'],
    },
    persistentCache: false,
    progress: false,
  },
  server: { hmr: false },
  plugins: [spikePlugin.farm()],
};
