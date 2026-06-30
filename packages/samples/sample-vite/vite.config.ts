import { defineConfig } from 'vite';
import DotnetAssets from 'unplugin-dotnet-static-assets/vite';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [
    DotnetAssets({
      projectRoot: resolve(__dirname, '../SampleLibrary'),
      projectName: 'SampleLibrary',
      configuration: 'Debug',
      targetFramework: 'net10.0',
      logLevel: 'info',
    }),
  ],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },
});
