import DotnetWasm from 'unplugin-dotnet-wasm/bun';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const outdir = resolve(__dirname, 'dist');

const result = await Bun.build({
  entrypoints: [resolve(__dirname, 'src/entry.ts')],
  outdir,
  target: 'node',
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
      projectRoot: resolve(__dirname, '../../Library'),
      projectName: 'Library',
      configuration: 'Release',
      isPublish: true,
      targetFramework: 'net10.0',
      logLevel: 'info',
    }),
  ],
});

if (!result.success) {
  console.error('Build failed:', result.logs);
  process.exit(1);
}
