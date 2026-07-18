import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    vite: 'src/vite.ts',
    rollup: 'src/rollup.ts',
    rolldown: 'src/rolldown.ts',
    webpack: 'src/webpack.ts',
    rspack: 'src/rspack.ts',
    rsbuild: 'src/rsbuild.ts',
    esbuild: 'src/esbuild.ts',
    farm: 'src/farm.ts',
    bun: 'src/bun.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  target: 'node20',
  external: [
    'vite',
    'webpack',
    'rollup',
    'rolldown',
    'esbuild',
    '@rspack/core',
    '@rsbuild/core',
    '@farmfe/core',
  ],
});
