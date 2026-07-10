import { defineConfig } from 'vite';
import DotnetAssets from 'unplugin-dotnet-wasm/vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => {
  const isRelease = mode === 'production';
  return {
    plugins: [
      DotnetAssets({
        projectRoot: resolve(__dirname, '../../Library'),
        projectName: 'Library',
        configuration: isRelease ? 'Release' : 'Debug',
        isPublish: isRelease,
        targetFramework: 'net10.0',
        logLevel: 'info',
      }),
    ],
    build: {
      outDir: 'dist',
      rollupOptions: {
        input: resolve(__dirname, 'src/entry.ts'),
        preserveEntrySignatures: 'strict',
        output: {
          format: 'es',
          entryFileNames: 'entry.js',
        },
      },
    },
  };
});
