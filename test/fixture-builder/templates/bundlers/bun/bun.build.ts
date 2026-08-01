import DotnetWasm from 'unplugin-dotnet-wasm/bun';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const projectRoot = process.env.DOTNET_PROJECT_ROOT;
if (!projectRoot) {
  throw new Error('DOTNET_PROJECT_ROOT env var is required (set by the fixture-builder).');
}
const configuration = process.env.DOTNET_CONFIGURATION === 'Release' ? 'Release' : 'Debug';
const isPublish = process.env.DOTNET_IS_PUBLISH === 'true';
const platform = process.env.DOTNET_FIXTURE_PLATFORM === 'node' ? 'node' : 'browser';
const outdir = resolve(__dirname, 'dist');

const result = await Bun.build({
  entrypoints: [resolve(__dirname, 'src/entry.ts')],
  outdir,
  target: platform,
  format: 'esm',
  minify: false,
  naming: {
    entry: '[name].[ext]',
    asset: 'assets/[name]-[hash].[ext]',
  },
  loader: {
    '.wasm': 'file',
    '.dat': 'file',
    '.pdb': 'file',
  },
  plugins: [
    DotnetWasm({
      projectRoot,
      projectName: 'Library',
      configuration,
      isPublish,
      targetFramework: 'net10.0',
      logLevel: 'info',
    }),
  ],
});

if (!result.success) {
  console.error('Build failed:', result.logs);
  process.exit(1);
}

if (platform === 'browser') {
  mkdirSync(outdir, { recursive: true });
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
}
