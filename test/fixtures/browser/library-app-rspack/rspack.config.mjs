import { rspack } from '@rspack/core';
import DotnetAssets from 'unplugin-dotnet-wasm/rspack';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default (env, argv) => {
  const isRelease = argv.mode === 'production';
  return {
    mode: argv.mode ?? 'production',
    target: 'web',
    entry: { main: resolve(__dirname, 'src/entry.ts') },
    output: {
      path: resolve(__dirname, 'dist'),
      filename: 'assets/entry.js',
      assetModuleFilename: 'assets/[name]-[contenthash][ext]',
      publicPath: '',
      clean: true,
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
      new rspack.HtmlRspackPlugin({ template: './src/index.html' }),
      DotnetAssets({
        projectRoot: resolve(__dirname, '../../Library'),
        projectName: 'Library',
        configuration: isRelease ? 'Release' : 'Debug',
        isPublish: isRelease,
        targetFramework: 'net10.0',
        logLevel: 'info',
      }),
    ],
    devServer: {
      port: 5174,
      static: false,
      historyApiFallback: true,
      hot: false,
    },
  };
};
