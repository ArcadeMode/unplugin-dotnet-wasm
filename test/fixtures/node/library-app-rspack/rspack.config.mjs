import DotnetWasm from 'unplugin-dotnet-wasm/rspack';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default (env, argv) => {
  const isRelease = argv.mode === 'production';
  return {
    mode: argv.mode ?? 'production',
    target: 'node',
    entry: { main: resolve(__dirname, 'src/entry.ts') },
    experiments: { outputModule: true },
    output: {
      path: resolve(__dirname, 'dist'),
      filename: 'entry.js',
      assetModuleFilename: 'assets/[name]-[contenthash][ext]',
      module: true,
      chunkFormat: 'module',
      library: { type: 'module' },
      publicPath: 'auto',
      clean: true,
    },
    resolve: {
      extensions: ['.ts', '.js'],
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          loader: 'builtin:swc-loader',
          options: {
            jsc: { parser: { syntax: 'typescript' } },
            env: { targets: 'defaults' },
          },
          type: 'javascript/auto',
        },
      ],
    },
    optimization: { minimize: false },
    plugins: [
      DotnetWasm({
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
