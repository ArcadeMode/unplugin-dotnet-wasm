import * as rollup from 'rollup';
import DotnetAssets from 'unplugin-dotnet-wasm/rollup';
import esbuild from 'rollup-plugin-esbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const outdir = resolve(__dirname, 'dist');

const bundle = await rollup.rollup({
  input: resolve(__dirname, 'src/entry.ts'),
  preserveEntrySignatures: 'strict',
  external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
  plugins: [
    DotnetAssets({
      projectRoot: resolve(__dirname, '../../Library'),
      projectName: 'Library',
      configuration: 'Release',
      isPublish: true,
      targetFramework: 'net10.0',
      logLevel: 'info',
    }),
    esbuild({ target: 'es2022', platform: 'node' }),
  ],
});

await bundle.write({
  format: 'es',
  dir: outdir,
  entryFileNames: 'entry.js',
});

await bundle.close();
process.exit(0);
