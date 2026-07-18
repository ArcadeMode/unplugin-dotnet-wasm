import DotnetAssets from 'unplugin-dotnet-wasm/rollup';
import nodeResolve from '@rollup/plugin-node-resolve';
import esbuild from 'rollup-plugin-esbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const isRelease = process.env.BUILD === 'production';

const emitHtml = {
  name: 'emit-html',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'index.html',
      source: readFileSync(new URL('./src/index.html', import.meta.url), 'utf-8'),
    });
  },
};

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
      projectRoot: resolve(__dirname, '../../Library'),
      projectName: 'Library',
      configuration: isRelease ? 'Release' : 'Debug',
      isPublish: isRelease,
      targetFramework: 'net10.0',
      logLevel: 'info',
    }),
    nodeResolve({ browser: true }),
    esbuild({ target: 'es2022' }),
    emitHtml,
  ],
};
