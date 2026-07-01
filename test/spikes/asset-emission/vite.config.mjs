import { spikePlugin } from './plugin.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

export default {
  root: HERE,
  logLevel: 'warn',
  build: {
    outDir: resolve(HERE, 'dist-vite'),
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: resolve(HERE, 'src/entry.mjs'),
      output: {
        entryFileNames: 'entry.js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  plugins: [spikePlugin.vite()],
};
