import { defineConfig } from 'vite';
import DotnetWasm from 'unplugin-dotnet-wasm/vite';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [
    DotnetWasm({
      projectRoot: resolve(import.meta.dirname, '../BlazorLibrary'),
      projectName: 'BlazorLibrary',
      configuration: 'Debug',
      targetFramework: 'net10.0',
      logLevel: 'info',
    }),
  ],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: resolve(import.meta.dirname, 'index.html'),
    },
  },
});
