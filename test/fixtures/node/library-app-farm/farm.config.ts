import DotnetAssets from 'unplugin-dotnet-static-assets/farm';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default {
  compilation: {
    input: {
      index: resolve(__dirname, 'src/entry.ts'),
    },
    output: {
      path: './dist',
      targetEnv: 'node-next',
    },
    assets: {
      include: ['wasm', 'dat', 'pdb'],
    },
  },
  plugins: [
    DotnetAssets({
      projectRoot: resolve(__dirname, '../../Library'),
      projectName: 'Library',
      configuration: 'Debug',
      targetFramework: 'net10.0',
      logLevel: 'info',
    }),
  ],
};
