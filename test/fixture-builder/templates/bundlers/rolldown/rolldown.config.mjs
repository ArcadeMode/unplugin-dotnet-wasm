import DotnetWasm from 'unplugin-dotnet-wasm/rolldown';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';
import { rollupSentinelPlugin } from './sentinel.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const projectRoot = process.env.DOTNET_PROJECT_ROOT;
if (!projectRoot) {
  throw new Error('DOTNET_PROJECT_ROOT env var is required (set by the fixture-builder).');
}
const configuration = process.env.DOTNET_CONFIGURATION === 'Release' ? 'Release' : 'Debug';
const isPublish = process.env.DOTNET_IS_PUBLISH === 'true';
const platform = process.env.DOTNET_FIXTURE_PLATFORM === 'node' ? 'node' : 'browser';

const emitHtml = {
  name: 'emit-html',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'index.html',
      source: [
        '<!doctype html>',
        '<html lang="en">',
        '  <head><meta charset="UTF-8" /><title>Fixture - Library</title></head>',
        '  <body>',
        '    <script type="module" src="./assets/entry.js"></script>',
        '  </body>',
        '</html>',
        '',
      ].join('\n'),
    });
  },
};

const plugins = [
  DotnetWasm({
    projectRoot,
    projectName: 'Library',
    configuration,
    isPublish,
    targetFramework: 'net10.0',
    logLevel: 'info',
  }),
  rollupSentinelPlugin(),
];
if (platform === 'browser') plugins.push(emitHtml);

/** @type {import('rolldown').RolldownOptions} */
const config = {
  input: resolve(__dirname, 'src/entry.ts'),
  external:
    platform === 'node'
      ? [...builtinModules, ...builtinModules.map((m) => `node:${m}`)]
      : undefined,
  output: {
    dir: resolve(__dirname, 'dist'),
    format: 'esm',
    entryFileNames: platform === 'node' ? 'entry.js' : 'assets/entry.js',
    assetFileNames: 'assets/[name]-[hash][extname]',
  },
  plugins,
};

export default config;
