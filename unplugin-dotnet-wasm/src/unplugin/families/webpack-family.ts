import type { IncomingMessage, ServerResponse } from 'node:http';
import { createAssetMiddleware } from '../../core/dev-server/asset-middleware';
import { FRAMEWORK_BINARY_REGEX, FRAMEWORK_JS_REGEX, DOTNET_NODE_BUILTINS } from '../../core/constants';
import type { PluginContext } from '../context';

export interface WebpackFamilyHooks {
  webpack(compiler: { options: { context?: string; module?: { rules?: unknown[] } } }): void;
  rspack(compiler: { options: { context?: string; module?: { rules?: unknown[] } } }): void;
  rsbuild: { setup(api: { modifyRspackConfig(fn: (config: unknown) => void): void }): void };
}

type WebpackLikeOptions = {
  context?: string;
  resolve?: { fallback?: Record<string, unknown> };
  module?: { rules?: unknown[] };
  devServer?: Record<string, unknown>;
};

export function createWebpackFamily(ctx: PluginContext): WebpackFamilyHooks {
  // webpack-cli sets WEBPACK_SERVE; @rspack/cli does not, but its argv contains "serve".
  ctx.isServe = process.env.WEBPACK_SERVE === 'true' || process.argv.includes('serve');

  const binaryRule = { test: FRAMEWORK_BINARY_REGEX, type: 'asset/resource' };
  const jsParserRule = { test: FRAMEWORK_JS_REGEX, parser: { url: false } };

  function externalizeNodeBuiltins(opts: WebpackLikeOptions): void {
    opts.resolve ??= {};
    opts.resolve.fallback ??= {};
    for (const mod of DOTNET_NODE_BUILTINS) {
      if (!(mod in opts.resolve.fallback)) {
        opts.resolve.fallback[mod] = false;
      }
    }
  }

  function registerDevServerMiddleware(compiler: { options: WebpackLikeOptions }): void {
    if (!ctx.isServe) return;

    compiler.options.devServer ??= {};
    const devServerConfig = compiler.options.devServer as Record<string, unknown>;
    const existingSetup = devServerConfig.setupMiddlewares as ((middlewares: unknown[], devServer: unknown) => unknown[]) | undefined;

    devServerConfig.setupMiddlewares = (middlewares: unknown[], devServer: unknown): unknown[] => {
      const assetMiddlewareEntry = {
        name: 'unplugin-dotnet-wasm',
        middleware: (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void): void => {
          if (!ctx.assetResolver) {
            next();
            return;
          }
          ctx.assetMiddleware ??= createAssetMiddleware(ctx.assetResolver, ctx.logger);
          ctx.assetMiddleware(req, res, next);
        },
      };
      middlewares.unshift(assetMiddlewareEntry);

      if (existingSetup) {
        return existingSetup(middlewares, devServer);
      }
      return middlewares;
    };
  }

  function applyBuildConfig(config: unknown, { prepend = false } = {}): void {
    const opts = config as WebpackLikeOptions;
    if (opts.context) ctx.consumerRoot = opts.context;
    opts.module ??= { rules: [] };
    opts.module.rules ??= [];
    if (prepend) opts.module.rules.unshift(binaryRule, jsParserRule);
    else opts.module.rules.push(binaryRule, jsParserRule);
    externalizeNodeBuiltins(opts);
    registerDevServerMiddleware({ options: opts });
  }

  return {
    webpack: (compiler: { options: { context?: string; module?: { rules?: unknown[] } } }) => applyBuildConfig(compiler.options),
    rspack:  (compiler: { options: { context?: string; module?: { rules?: unknown[] } } }) => applyBuildConfig(compiler.options),
    rsbuild: { setup: api => api.modifyRspackConfig(config => applyBuildConfig(config, { prepend: true })) },
  };
}
