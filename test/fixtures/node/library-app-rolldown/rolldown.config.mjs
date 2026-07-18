import DotnetAssets from 'unplugin-dotnet-wasm/rolldown';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const isRelease = process.env.BUILD === 'production';

export default {
  input: resolve(__dirname, 'src/entry.ts'),
  output: {
    dir: resolve(__dirname, 'dist'),
    format: 'es',
    entryFileNames: 'entry.js',
  },
  external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
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
};
