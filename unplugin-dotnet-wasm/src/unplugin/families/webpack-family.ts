import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  FRAMEWORK_BINARY_REGEX,
  FRAMEWORK_JS_REGEX,
  DOTNET_NODE_BUILTINS,
} from '../../core/constants';
import type { PluginContext } from '../context';

type CompilerHooks = {
  beforeRun: { tapPromise(name: string, fn: () => Promise<void>): void };
  watchRun: { tapPromise(name: string, fn: () => Promise<void>): void };
};

type WebpackCompiler = {
  options: { context?: string; module?: { rules?: unknown[] } };
  hooks: CompilerHooks;
};

export interface WebpackFamilyHooks {
  webpack(compiler: WebpackCompiler): void;
  rspack(compiler: WebpackCompiler): void;
  rsbuild: {
    setup(api: {
      modifyRspackConfig(fn: (config: unknown) => void): void;
      onAfterCreateCompiler(fn: (ctx: { compiler: unknown }) => void): void;
      onBeforeStartDevServer(
        fn: (ctx: {
          server: {
            middlewares: {
              use(
                handler: (
                  req: IncomingMessage,
                  res: ServerResponse,
                  next: (err?: unknown) => void,
                ) => void,
              ): void;
            };
          };
        }) => void,
      ): void;
    }): void;
  };
}

type WebpackLikeOptions = {
  context?: string;
  resolve?: { fallback?: Record<string, unknown> };
  module?: { rules?: unknown[] };
  devServer?: Record<string, unknown>;
};

export function createWebpackFamily(ctx: PluginContext): WebpackFamilyHooks {
  // webpack-cli sets WEBPACK_SERVE; @rspack/cli does not, but its argv contains "serve".
  const isServe = process.env.WEBPACK_SERVE === 'true' || process.argv.includes('serve');

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

  // unplugin's buildStart isn't awaited for this family (resolve begins before initialization completes)
  // workaround: https://github.com/unjs/unplugin/issues/293
  function awaitContextInit(compiler: { hooks?: CompilerHooks }): void {
    compiler.hooks?.beforeRun?.tapPromise('unplugin-dotnet-wasm', () => ctx.initialize());
    compiler.hooks?.watchRun?.tapPromise('unplugin-dotnet-wasm', () => ctx.initialize());
  }

  function registerDevServerMiddleware(compiler: { options: WebpackLikeOptions }): void {
    if (!isServe) return;

    compiler.options.devServer ??= {};
    const devServerConfig = compiler.options.devServer as Record<string, unknown>;
    const existingSetup = devServerConfig.setupMiddlewares as
      ((middlewares: unknown[], devServer: unknown) => unknown[]) | undefined;

    devServerConfig.setupMiddlewares = (middlewares: unknown[], devServer: unknown): unknown[] => {
      const assetMiddlewareEntry = {
        name: 'unplugin-dotnet-wasm',
        middleware: (
          req: IncomingMessage,
          res: ServerResponse,
          next: (err?: unknown) => void,
        ): void => {
          ctx.enableAssetMiddleware();
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
    if (opts.context) ctx.setConsumerRoot(opts.context);
    opts.module ??= { rules: [] };
    opts.module.rules ??= [];
    if (prepend) opts.module.rules.unshift(binaryRule, jsParserRule);
    else opts.module.rules.push(binaryRule, jsParserRule);
    externalizeNodeBuiltins(opts);
    registerDevServerMiddleware({ options: opts });
  }

  return {
    webpack: (compiler) => {
      applyBuildConfig(compiler.options);
      awaitContextInit(compiler);
    },
    rspack: (compiler) => {
      applyBuildConfig(compiler.options);
      awaitContextInit(compiler);
    },
    rsbuild: {
      setup(api) {
        api.modifyRspackConfig((config) => applyBuildConfig(config, { prepend: true }));
        api.onAfterCreateCompiler(({ compiler }) => {
          const c = compiler as { hooks?: CompilerHooks };
          awaitContextInit(c);
        });
        api.onBeforeStartDevServer(({ server }) => {
          server.middlewares.use((req, res, next) => {
            ctx.enableAssetMiddleware();
            ctx.assetMiddleware(req, res, next);
          });
        });
      },
    },
  };
}
