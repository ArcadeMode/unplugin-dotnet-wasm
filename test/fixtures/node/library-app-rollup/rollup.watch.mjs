import * as rollup from 'rollup';
import DotnetWasm from 'unplugin-dotnet-wasm/rollup';
import esbuild from 'rollup-plugin-esbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const outdir = resolve(__dirname, 'dist');

// `node rollup.watch.mjs` => debug; `node rollup.watch.mjs release` => release.
const isRelease = process.argv[2] === 'release';

const watcher = rollup.watch({
  input: resolve(__dirname, 'src/entry.ts'),
  preserveEntrySignatures: 'strict',
  external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
  plugins: [
    DotnetWasm({
      projectRoot: resolve(__dirname, '../../Library'),
      projectName: 'Library',
      configuration: isRelease ? 'Release' : 'Debug',
      isPublish: isRelease,
      targetFramework: 'net10.0',
      logLevel: 'info',
    }),
    esbuild({ target: 'es2022', platform: 'node' }),
  ],
  output: {
    format: 'es',
    dir: outdir,
    entryFileNames: 'entry.js',
  },
});

watcher.on('event', (event) => {
  if (event.code === 'ERROR') {
    console.error(event.error);
  } else if (event.code === 'BUNDLE_END') {
    console.log(`[rollup] rebuilt (${isRelease ? 'release' : 'debug'})`);
    event.result?.close();
  } else if (event.code === 'END') {
    console.log('[rollup] watching for changes...');
  }
});

process.on('SIGINT', () => {
  watcher.close();
  process.exit(0);
});
