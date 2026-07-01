import { spikePlugin } from './plugin.mjs';

export default {
  input: 'src/entry.mjs',
  output: {
    dir: 'dist-rollup',
    format: 'esm',
    assetFileNames: 'assets/[name]-[hash][extname]',
  },
  plugins: [spikePlugin.rollup()],
};
