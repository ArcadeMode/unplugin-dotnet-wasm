import { spikePlugin } from './plugin.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

export default {
  mode: 'production',
  target: 'web',
  entry: resolve(HERE, 'src/entry.mjs'),
  output: {
    path: resolve(HERE, 'dist-webpack'),
    filename: 'main.js',
    assetModuleFilename: 'assets/[name]-[hash][ext]',
    publicPath: '',
  },
  plugins: [spikePlugin.webpack()],
  optimization: {
    minimize: false,
  },
};
