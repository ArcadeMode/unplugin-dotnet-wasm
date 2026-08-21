import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import DotnetWasm from 'unplugin-dotnet-wasm/vite';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [
    tailwindcss(),
    DotnetWasm({
      projectRoot: resolve(import.meta.dirname, '../../libraries/BlazorElements'),
      projectName: 'BlazorElements',
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
