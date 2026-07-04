import { build } from '@rolldown/node';
import DotnetAssets from 'unplugin-dotnet-static-assets/rolldown';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const outdir = resolve(__dirname, 'dist');

await build({
  input: resolve(__dirname, 'src/entry.ts'),
  output: {
    dir: outdir,
    format: 'es',
    entryFileNames: 'entry.js',
  },
  external: [],
  plugins: [
    DotnetAssets({
      projectRoot: resolve(__dirname, '../../Library'),
      projectName: 'Library',
      configuration: 'Debug',
      targetFramework: 'net10.0',
      logLevel: 'info',
    }),
  ],
});

process.exit(0);
