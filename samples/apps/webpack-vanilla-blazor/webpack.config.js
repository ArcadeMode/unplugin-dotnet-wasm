const path = require('node:path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const DotnetWasm = require('unplugin-dotnet-wasm/webpack').default;

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';

  return {
    entry: './src/index.ts',
    target: 'web',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'assets/[name].js',
      assetModuleFilename: 'assets/[name]-[contenthash][ext]',
      publicPath: '/',
      clean: true,
    },
    resolve: {
      extensions: ['.ts', '.js'],
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: {
            loader: 'ts-loader',
            options: { transpileOnly: true },
          },
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          use: [MiniCssExtractPlugin.loader, 'css-loader'],
        },
        {
          test: /sample-data[\\/].+\.json$/,
          type: 'asset/resource',
          generator: { filename: 'sample-data/[name][ext]' },
        },
        {
          test: /\.png$/,
          type: 'asset/resource',
          generator: { filename: '[name][ext]' },
        },
      ],
    },
    plugins: [
      DotnetWasm({
        projectName: 'BlazorApp',
        projectRoot: path.resolve(__dirname, '../../libraries/BlazorApp'),
        configuration: isProduction ? 'Release' : 'Debug',
        targetFramework: 'net10.0',
        isPublish: isProduction,
        logLevel: 'info',
      }),
      new MiniCssExtractPlugin({
        filename: 'assets/[name].css',
      }),
      new HtmlWebpackPlugin({
        template: './index.html',
        // If set to 'module', Blazor will NOT auto-start — call Blazor.start() yourself.
        // scriptLoading: 'module',
      }),
    ],
    devServer: {
      // Required for Blazor's client-side router.
      historyApiFallback: true,
      hot: false,
      open: true,
      port: 5080,
    },
    devtool: isProduction ? false : 'source-map',
  };
};
