import { rspack } from '@rspack/core';
import DotnetWasm from 'unplugin-dotnet-wasm/rspack';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const projectRoot = process.env.DOTNET_PROJECT_ROOT;
if (!projectRoot) {
  throw new Error('DOTNET_PROJECT_ROOT env var is required (set by the fixture-builder).');
}
const configuration = process.env.DOTNET_CONFIGURATION === 'Release' ? 'Release' : 'Debug';
const isPublish = process.env.DOTNET_IS_PUBLISH === 'true';
const platform = process.env.DOTNET_FIXTURE_PLATFORM === 'node' ? 'node' : 'browser';

export default (_env, argv) => {
  const dotnet = DotnetWasm({
    projectRoot,
    projectName: 'Library',
    configuration,
    isPublish,
    targetFramework: 'net10.0',
    logLevel: 'info',
  });

  const common = {
    mode: argv.mode ?? 'development',
    entry: resolve(__dirname, 'src/entry.ts'),
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
  };

  if (platform === 'node') {
    return {
      ...common,
      target: 'node',
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
      plugins: [dotnet],
    };
  }

  return {
    ...common,
    target: 'web',
    output: {
      path: resolve(__dirname, 'dist'),
      filename: 'assets/entry.js',
      assetModuleFilename: 'assets/[name]-[contenthash][ext]',
      publicPath: '',
      clean: true,
    },
    devServer: {
      static: false,
      historyApiFallback: true,
      hot: false,
    },
    plugins: [new rspack.HtmlRspackPlugin(), dotnet],
  };
};
