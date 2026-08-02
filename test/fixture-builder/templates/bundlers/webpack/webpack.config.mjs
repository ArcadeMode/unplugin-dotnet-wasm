import DotnetWasm from 'unplugin-dotnet-wasm/webpack';
import HtmlWebpackPlugin from 'html-webpack-plugin';
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
    logLevel: 'debug',
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
          loader: 'ts-loader',
          options: { transpileOnly: true },
          exclude: /node_modules/,
        },
      ],
    },
    optimization: { minimize: false },
  };

  if (platform === 'node') {
    // Node: emit a runnable ESM `dist/entry.js`; no HTML, no dev server.
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
        clean: true,
      },
      plugins: [dotnet],
    };
  }

  // Browser: dev-server + injected HTML document.
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
    plugins: [
      // Generate a fresh HTML document and inject the compiled bundle; the shared
      // index.html is vite-flavored (references /src/entry.ts directly), so we let
      // HtmlWebpackPlugin own the document here.
      new HtmlWebpackPlugin(),
      dotnet,
    ],
  };
};
