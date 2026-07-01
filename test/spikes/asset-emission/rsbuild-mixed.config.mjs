import { spikePlugin } from './plugin.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

// Same as rsbuild.config.mjs but the entry additionally imports a user-owned
// `other.wasm` as an ES module (named export `f`). Proves that our scoped
// asset/resource rule doesn't steal `.wasm` files it didn't resolve — rsbuild's
// default `experiments.asyncWebAssembly` handling must still link the named
// import successfully.
export default {
  source: {
    entry: {
      main: resolve(HERE, 'src/entry-mixed.mjs'),
    },
  },
  output: {
    distPath: {
      root: resolve(HERE, 'dist-rsbuild-mixed'),
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
