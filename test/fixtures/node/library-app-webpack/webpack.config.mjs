import DotnetAssets from 'unplugin-dotnet-wasm/webpack';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default (env, argv) => {
  const isRelease = argv.mode === 'production';
  return {
    mode: argv.mode ?? 'production',
    target: 'node',
    entry: resolve(__dirname, 'src/entry.ts'),
    experiments: { outputModule: true },
    output: {
      path: resolve(__dirname, 'dist'),
      filename: 'entry.js',
      assetModuleFilename: 'assets/[name]-[contenthash][ext]',
      module: true,
      chunkFormat: 'module',
      library: { type: 'module' },
      clean: true,
    },
    resolve: {
      extensions: ['.ts', '.js'],
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          loader: 'ts-loader',
          options: { transpileOnly: true },
          exclude: /node_modules/,
        },
      ],
    },
    optimization: { minimize: false },
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
};
