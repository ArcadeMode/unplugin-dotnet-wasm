import * as esbuild from 'esbuild';
import DotnetWasm from 'unplugin-dotnet-wasm/esbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { esbuildSentinelPlugin } from './sentinel.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const platform = process.argv[2] === 'node' ? 'node' : 'browser';
const watch = process.argv.includes('--watch');

const projectRoot = process.env.DOTNET_PROJECT_ROOT;
if (!projectRoot) {
  throw new Error('DOTNET_PROJECT_ROOT env var is required (set by the fixture-builder).');
}
const configuration = process.env.DOTNET_CONFIGURATION === 'Release' ? 'Release' : 'Debug';
const isPublish = process.env.DOTNET_IS_PUBLISH === 'true';
const outdir = resolve(__dirname, 'dist');

// esbuild has no HTML pipeline; emit a document that loads the built bundle.
const emitHtml = {
  name: 'emit-html',
  setup(build) {
    build.onEnd(() => {
      writeFileSync(
        resolve(outdir, 'index.html'),
        [
          '<!doctype html>',
          '<html lang="en">',
          '  <head><meta charset="UTF-8" /><title>Fixture - Library</title></head>',
          '  <body>',
          '    <script type="module" src="./entry.js"></script>',
          '  </body>',
          '</html>',
          '',
        ].join('\n'),
      );
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
];
if (platform === 'browser') plugins.push(emitHtml);
plugins.push(esbuildSentinelPlugin);

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [resolve(__dirname, 'src/entry.ts')],
  outdir,
  bundle: true,
  format: 'esm',
  platform,
  // Node runs `dist/entry.js`; browser loads `dist/entry.js` from the document.
  entryNames: 'entry',
  assetNames: 'assets/[name]-[hash]',
  plugins,
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
