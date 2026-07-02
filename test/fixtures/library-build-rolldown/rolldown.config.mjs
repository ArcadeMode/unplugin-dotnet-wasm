import DotnetAssets from 'unplugin-dotnet-static-assets/rolldown';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default {
  input: resolve(__dirname, 'src/entry.ts'),
  output: {
    dir: resolve(__dirname, 'dist'),
    format: 'esm',
    entryFileNames: 'assets/entry.js',
    assetFileNames: 'assets/[name]-[hash][extname]',
  },
  plugins: [
    DotnetAssets({
      projectRoot: resolve(__dirname, '../Library'),
      projectName: 'Library',
      configuration: 'Debug',
      targetFramework: 'net10.0',
      logLevel: 'info',
    }),
  ],
};
