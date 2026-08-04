import {
  FRAMEWORK_BINARY_REGEX,
  FRAMEWORK_JS_REGEX,
  DOTNET_NODE_BUILTINS,
  VIRTUAL_ROUTE_PREFIX,
  VIRTUAL_ROUTE_ID_REGEX,
} from '../../core/constants';
import { ManifestWatcher } from '../../core/dev-server/manifest-watcher';
import type { PluginContext } from '../context';
import { createRsbuildSetup, type RsbuildHooks } from './rsbuild-dev-server';
import {
  getManifestWatchPaths,
  getVirtualizedModuleContent,
  resolveVirtualId,
  type LoadHandlerContext,
} from './virtual-resolution';

export type CompilerHooks = {
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
  invalidate?(callback?: () => void): void;
};

export interface WebpackFamilyHooks {
  buildStart(this: object): Promise<void>;
  resolveId(source: string, importer?: string): string | null;
  load: {
    filter: { id: RegExp };
    handler(this: LoadHandlerContext, id: string): Promise<string | null>;
  };
  webpack(compiler: WebpackCompiler): void;
  rspack(compiler: WebpackCompiler): void;
  rsbuild: RsbuildHooks;
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
  // rsbuild's dev command is `rsbuild dev` (no "serve"), so it can't be detected here;
  // the rsbuild dev-server hook flips this to true before compilation starts.
  let isServe = process.env.WEBPACK_SERVE === 'true' || process.argv.includes('serve');
  const isWatch = process.argv.includes('--watch') || process.argv.includes('-w');
  const binaryRule = { test: FRAMEWORK_BINARY_REGEX, type: 'asset/resource' };
  const jsParserRule = { test: FRAMEWORK_JS_REGEX, parser: { url: false } };
  // Disable webpack/rspack's `new URL()` asset parsing for virtual identifiers
  const virtualJsParserRule = { test: /%00dotnet-wasm%3A/i, parser: { url: false } };

  const manifestWatchPaths = getManifestWatchPaths(ctx);

  function resolveId(source: string, importer?: string): string | null {
    if (isWatch || isServe) {
      return resolveVirtualId(ctx, source, importer, { binaryAsVirtual: true });
    }
    return ctx.assetResolver.resolve(source);
  }

  const load = {
    filter: { id: VIRTUAL_ROUTE_ID_REGEX }, // virtual ids only!
    handler: async function (this: LoadHandlerContext, id: string): Promise<string | null> {
      if (!id.startsWith(VIRTUAL_ROUTE_PREFIX)) return null;

      const route = id.slice(VIRTUAL_ROUTE_PREFIX.length);
      const result = await getVirtualizedModuleContent(ctx, route);
      if (result === null) return null;
      for (const watchPath of [result.path, ...manifestWatchPaths]) this.addWatchFile(watchPath);
      return result.code;
    },
  };

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

  function watchStaticWebassetsManifests(devServer: WebpackDevServerInstance): void {
    // Set up manifest watcher for webpack/rspack
    const watcher = new ManifestWatcher({
      paths: manifestWatchPaths,
      onChange: () => {
        ctx.logger.debug('[serve] ManifestWatcher.onChange fired, reinitializing');
        return ctx.reinitialize();
      },
      logger: ctx.logger,
    });

    ctx.onReinitialized(() => {
      // Request recompile and reload.
      devServer.invalidate?.();

      const clients = devServer.webSocketServer?.clients ?? [];
      if (typeof devServer.sendMessage === 'function') {
        devServer?.sendMessage(clients, 'static-changed'); //webpack-dev-server
      } else {
        for (const client of clients) {
          client.send(JSON.stringify({ type: 'static-changed' })); // @rspack/dev-server
        }
      }
    });

    watcher.start();

    // Dispose on server close
    devServer.server?.once('close', () => watcher.dispose());
  }

  function registerDevServerMiddleware(compiler: { options: WebpackLikeOptions }): void {
    if (!isServe) return;

    compiler.options.devServer ??= {};
    const devServerConfig = compiler.options.devServer as Record<string, unknown>;
    const existingSetup = devServerConfig.setupMiddlewares as
      ((middlewares: unknown[], devServer: unknown) => unknown[]) | undefined;

    devServerConfig.setupMiddlewares = (
      middlewares: unknown[],
      devServer: WebpackDevServerInstance,
    ): unknown[] => {
      middlewares.unshift({
        name: 'unplugin-dotnet-wasm',
        middleware: (...args: Parameters<typeof ctx.assetMiddleware>) => {
          ctx.assetMiddleware(...args);
        },
      });

      watchStaticWebassetsManifests(devServer);
      return existingSetup?.(middlewares, devServer) ?? middlewares;
    };
  }

  function applyBuildConfig(config: unknown, { prepend = false } = {}): void {
    const opts = config as WebpackLikeOptions;
    if (opts.context) ctx.setConsumerRoot(opts.context);
    opts.module ??= { rules: [] };
    opts.module.rules ??= [];
    if (prepend) opts.module.rules.unshift(binaryRule, jsParserRule, virtualJsParserRule);
    else opts.module.rules.push(binaryRule, jsParserRule, virtualJsParserRule);

    externalizeNodeBuiltins(opts);
  }

  return {
    async buildStart(this: object): Promise<void> {
      ctx.logger.debug(`[build] buildStart invoked in webpack-family`);
      await ctx.initialize();
      if (isWatch && !isServe) await ctx.reinitialize(); // No dev server to control rebuilds, ensure manifests pulled in before every (re)build
      ctx.logger.debug(`[build] buildStart completed in webpack-family`);
    },
    resolveId,
    load,
    webpack: (compiler) => {
      applyBuildConfig(compiler.options);
      awaitContextInit(compiler);
      registerDevServerMiddleware(compiler);
    },
    rspack: (compiler) => {
      applyBuildConfig(compiler.options);
      awaitContextInit(compiler);
      registerDevServerMiddleware(compiler);
    },
    rsbuild: createRsbuildSetup(ctx, {
      applyBuildConfig,
      awaitContextInit,
      manifestWatchPaths,
      markServe: () => {
        isServe = true;
      },
    }),
  };
}
