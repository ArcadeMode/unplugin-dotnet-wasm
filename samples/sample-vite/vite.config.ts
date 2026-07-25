import { defineConfig } from 'vite';
import DotnetWasm from 'unplugin-dotnet-wasm/vite';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [
    DotnetWasm({
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
