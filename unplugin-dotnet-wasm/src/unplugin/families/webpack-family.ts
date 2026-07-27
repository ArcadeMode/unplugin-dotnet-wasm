import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  FRAMEWORK_BINARY_REGEX,
  FRAMEWORK_JS_REGEX,
  DOTNET_NODE_BUILTINS,
} from '../../core/constants';
import { discoverManifests } from '../../core/manifest-parsing/discover';
import { ManifestWatcher } from '../../core/dev-server/manifest-watcher';
import type { PluginContext } from '../context';

type CompilerHooks = {
  beforeRun: { tapPromise(name: string, fn: () => Promise<void>): void };
  watchRun: {
    tapPromise(name: string, fn: () => Promise<void>): void;
  };
  thisCompilation: {
    tap(
      name: string,
      fn: (compilation: { contextDependencies: { add(dir: string): void } }) => void,
    ): void;
  };
};

type WebpackCompiler = {
  options: { context?: string; module?: { rules?: unknown[] } };
  hooks: CompilerHooks;
};

type WebSocketClient = { send(data: string): void };

// Subset of the webpack-dev-server / @rspack/dev-server `Server` instance handed
// to `setupMiddlewares(middlewares, devServer)`.
type WebpackDevServerInstance = {
  webSocketServer?: { clients: WebSocketClient[] } | null;
  sendMessage?(clients: WebSocketClient[], type: string, data?: unknown): void;
  server?: { once(event: 'close', listener: () => void): void } | null;
};

// Subset of the rsbuild `RsbuildDevServer` handed to `onBeforeStartDevServer`.
type RsbuildDevServerInstance = {
  middlewares: {
    use(
      handler: (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void,
    ): void;
  };
  sockWrite(type: string, data?: unknown): void;
};

export interface WebpackFamilyHooks {
  webpack(compiler: WebpackCompiler): void;
  rspack(compiler: WebpackCompiler): void;
  rsbuild: {
    setup(api: {
      modifyRspackConfig(fn: (config: unknown) => void): void;
      onAfterCreateCompiler(fn: (ctx: { compiler: unknown }) => void): void;
      onBeforeStartDevServer(fn: (ctx: { server: RsbuildDevServerInstance }) => void): void;
      onCloseDevServer(fn: () => void | Promise<void>): void;
    }): void;
  };
}

type WebpackLikeOptions = {
  context?: string;
  resolve?: { fallback?: Record<string, unknown> };
  module?: { rules?: unknown[] };
  devServer?: Record<string, unknown>;
  watchOptions?: { aggregateTimeout?: number; ignored?: unknown };
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
      middlewares.unshift({
        name: 'unplugin-dotnet-wasm',
        middleware: (...args: Parameters<typeof ctx.assetMiddleware>) => {
          ctx.assetMiddleware(...args);
        },
      });

      // Set up manifest watcher for webpack/rspack
      const { endpointsManifestPath, runtimeManifestPath } = discoverManifests(ctx.options);
      const paths = [endpointsManifestPath, runtimeManifestPath].filter((p) => p !== null);
      const watcher = new ManifestWatcher({
        paths,
        onChange: () => ctx.reinitialize(),
        logger: ctx.logger,
      });

      ctx.onReinitialized(() => {
        const server = devServer as WebpackDevServerInstance;
        const clients = server.webSocketServer?.clients;
        if (!clients || clients.length === 0) return;
        // webpack-dev-server / @rspack/dev-server clients only trigger a full page
        // reload on the "static-changed" message.
        if (typeof server.sendMessage === 'function') {
          server.sendMessage(clients, 'static-changed');
        } else {
          for (const client of clients) {
            client.send(JSON.stringify({ type: 'static-changed' }));
          }
        }
      });

      watcher.start();

      // Dispose on server close
      (devServer as WebpackDevServerInstance).server?.once('close', () => watcher.dispose());

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
  }

  function watchContentRoots(compiler: { hooks?: CompilerHooks }): void {
    if (!isServe) return;

    compiler.hooks?.thisCompilation.tap('unplugin-dotnet-wasm', (compilation) => {
      ctx.onInitialized(() => {
        for (const root of ctx.assetResolver.roots()) {
          compilation.contextDependencies.add(root);
        }
      });
    });
  }

  return {
    webpack: (compiler) => {
      applyBuildConfig(compiler.options);
      awaitContextInit(compiler);
      registerDevServerMiddleware(compiler);
      watchContentRoots(compiler);
    },
    rspack: (compiler) => {
      applyBuildConfig(compiler.options);
      awaitContextInit(compiler);
      registerDevServerMiddleware(compiler);
      watchContentRoots(compiler);
    },
    rsbuild: {
      setup(api) {
        api.modifyRspackConfig((config) => {
          applyBuildConfig(config, { prepend: true });
        });
        api.onAfterCreateCompiler(({ compiler }) => {
          const c = compiler as { hooks?: CompilerHooks };
          awaitContextInit(c);
          watchContentRoots(c);
        });
        api.onBeforeStartDevServer(({ server }) => {
          server.middlewares.use((...args: Parameters<typeof ctx.assetMiddleware>) => {
            ctx.assetMiddleware(...args);
          });

          // Set up manifest watcher for rsbuild
          const { endpointsManifestPath, runtimeManifestPath } = discoverManifests(ctx.options);
          const paths = [endpointsManifestPath, runtimeManifestPath].filter((p) => p !== null);
          const watcher = new ManifestWatcher({
            paths,
            onChange: () => ctx.reinitialize(),
            logger: ctx.logger,
          });

          // rsbuild exposes `sockWrite` as the public HMR channel; "static-changed"
          // triggers a full page reload on all connected clients.
          ctx.onReinitialized(() => {
            server.sockWrite('static-changed');
          });

          watcher.start();

          // Dispose on server close
          api.onCloseDevServer(() => watcher.dispose());
        });
      },
    },
  };
}
