import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    vite: 'src/vite.ts',
    rollup: 'src/rollup.ts',
    webpack: 'src/webpack.ts',
    esbuild: 'src/esbuild.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  target: 'node20',
  external: ['vite', 'webpack', 'rollup', 'esbuild'],
});
