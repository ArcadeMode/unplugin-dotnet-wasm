import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import {
  FRAMEWORK_BINARY_REGEX,
  FRAMEWORK_JS_REGEX,
  DOTNET_NODE_BUILTINS,
  VIRTUAL_ROUTE_PREFIX,
  VIRTUAL_ROUTE_ID_REGEX,
} from '../../core/constants';
import { collapseDotSegments, toPosixPath } from '../../core/path-utils';
import { buildReexportAssetModule } from '../../core/asset-resolution/asset-url-module';
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
  invalidate?(callback?: () => void): void;
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

type Watching = {
  invalidate?: (callback?: () => void) => void;
  invalidateWithChangesAndRemovals?: (changed?: Set<string>, removed?: Set<string>) => void;
};
type RsbuildCompiler = { watching?: Watching; compilers?: { watching?: Watching }[] };

export interface WebpackFamilyHooks {
  resolveId(source: string, importer?: string): string | null;
  load: {
    filter: { id: RegExp };
    handler(this: LoadHandlerContext, id: string): Promise<string | null>;
  };
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

type LoadHandlerContext = { addWatchFile(id: string): void };

type WebpackLikeOptions = {
  context?: string;
  resolve?: { fallback?: Record<string, unknown> };
  module?: { rules?: unknown[] };
  devServer?: Record<string, unknown>;
  watchOptions?: { aggregateTimeout?: number; ignored?: unknown };
};

// webpack/rspack give the virtual routes back with weird prefixes.
// Parse the original virtual route back out without the VIRTUAL_ROUTE_PREFIX.
function importerVirtualRoute(importer: string | undefined): string | null {
  if (!importer) return null;
  let decoded = importer;
  if (!importer.startsWith(VIRTUAL_ROUTE_PREFIX)) {
    if (!importer.includes('dotnet-wasm')) return null;
    try {
      decoded = decodeURIComponent(importer);
    } catch {
      return null;
    }
  }
  const idx = decoded.indexOf(VIRTUAL_ROUTE_PREFIX);
  if (idx === -1) return null;
  return decoded.slice(idx + VIRTUAL_ROUTE_PREFIX.length);
}

export function createWebpackFamily(ctx: PluginContext): WebpackFamilyHooks {
  // webpack-cli sets WEBPACK_SERVE; @rspack/cli does not, but its argv contains "serve".
  // rsbuild's dev command is `rsbuild dev` (no "serve"), so it can't be detected here;
  // the rsbuild dev-server hook flips this to true before compilation starts.
  let isServe = process.env.WEBPACK_SERVE === 'true' || process.argv.includes('serve');
  const binaryRule = { test: FRAMEWORK_BINARY_REGEX, type: 'asset/resource' };
  const jsParserRule = { test: FRAMEWORK_JS_REGEX, parser: { url: false } };
  // Disable webpack/rspack's `new URL()` asset parsing for virtual identifiers
  const virtualJsParserRule = { test: /%00dotnet-wasm%3A/i, parser: { url: false } };

  const { endpointsManifestPath, runtimeManifestPath } = discoverManifests(ctx.options);
  const manifestWatchPaths = [endpointsManifestPath, runtimeManifestPath].filter(
    (p): p is string => p !== null,
  );

  function resolveId(source: string, importer?: string): string | null {
    if (!isServe) return ctx.assetResolver.resolve(source);

    // Absolute specifiers and virtual ids are already resolved. Let the bundler handle them.
    if (isAbsolute(source) || source.startsWith(VIRTUAL_ROUTE_PREFIX)) return null;

    let route = source;
    if (source.startsWith('./') || source.startsWith('../')) {
      const importerRoute = importerVirtualRoute(importer);
      if (importerRoute !== null) {
        const importerDir = importerRoute.slice(0, importerRoute.lastIndexOf('/'));
        route = collapseDotSegments(toPosixPath(`${importerDir}/${source}`));
      }
    }

    // Canonicalize to the stable, hash-free route (manifest-driven) so the
    // virtual identity survives fingerprint changes.
    const canonical = ctx.assetResolver.canonicalRoute(route);
    if (canonical === null) return null;
    const physical = ctx.assetResolver.resolve(canonical);
    if (physical === null) return null;
    if (FRAMEWORK_JS_REGEX.test(physical) || FRAMEWORK_BINARY_REGEX.test(physical)) {
      return VIRTUAL_ROUTE_PREFIX + canonical;
    }
    return physical;
  }

  async function readVirtualModule(
    loadCtx: LoadHandlerContext,
    route: string,
  ): Promise<string | null> {
    const physical = ctx.assetResolver.resolve(route);
    if (physical === null) {
      ctx.logger.debug(`[serve] load: route "${route}" resolved to null (no physical file)`);
      return null;
    }

    // addWatchFile ensures `load` is re-invoked when the file changes.
    // i.e. it invalidates the virtual route, important!
    loadCtx.addWatchFile(physical);
    // Also depend on the manifests so a manifest change forces this module to rebuild
    for (const manifestPath of manifestWatchPaths) loadCtx.addWatchFile(manifestPath);

    if (FRAMEWORK_BINARY_REGEX.test(physical)) {
      return buildReexportAssetModule(physical);
    }

    const code = await readFile(physical, 'utf8');
    return ctx.rewriter.rewrite(code) ?? code;
  }

  const load = {
    filter: { id: VIRTUAL_ROUTE_ID_REGEX }, // virtual ids only!
    handler: async function (this: LoadHandlerContext, id: string): Promise<string | null> {
      if (!id.startsWith(VIRTUAL_ROUTE_PREFIX)) return null;

      const route = id.slice(VIRTUAL_ROUTE_PREFIX.length);
      try {
        return await readVirtualModule(this, route);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        // Missing file _can_ mean that the manifest was updated (e.g. new fingerprints), reinit and try again.
        ctx.logger.debug(`[serve] load: ENOENT for route "${route}", reinitializing and retrying`);
        await ctx.reinitialize();
        return await readVirtualModule(this, route);
      }
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
      onChange: () => ctx.reinitialize(),
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

  function invalidateWatching(w: Watching | undefined, label: string): void {
    if (!w) {
      ctx.logger.debug(`[serve] invalidate: ${label} has no watching handle`);
      return;
    }
    if (typeof w.invalidateWithChangesAndRemovals === 'function') {
      w.invalidateWithChangesAndRemovals(new Set(manifestWatchPaths), new Set());
    } else if (typeof w.invalidate === 'function') {
      ctx.logger.debug(`[serve] invalidate: ${label} plain invalidate()`);
      w.invalidate();
    } else {
      ctx.logger.debug(`[serve] invalidate: ${label} exposes no invalidate method`);
    }
  }

  function invalidateRsbuild(rsbuildCompiler: RsbuildCompiler | null): void {
    if (!rsbuildCompiler) {
      ctx.logger.debug('[serve] invalidate: no compiler captured, cannot invalidate');
      return;
    }
    if (Array.isArray(rsbuildCompiler.compilers)) {
      ctx.logger.debug(
        `[serve] invalidate: MultiCompiler with ${rsbuildCompiler.compilers.length} child compiler(s)`,
      );
      rsbuildCompiler.compilers.forEach((c, i) => invalidateWatching(c.watching, `child[${i}]`));
    } else {
      invalidateWatching(rsbuildCompiler.watching, 'single compiler');
    }
  }

  let rsbuildCompiler: RsbuildCompiler | null = null;

  return {
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
    rsbuild: {
      setup(api) {
        api.modifyRspackConfig((config) => {
          applyBuildConfig(config, { prepend: true });
        });
        api.onAfterCreateCompiler(({ compiler }) => {
          rsbuildCompiler = compiler as RsbuildCompiler;
          const isMulti = Array.isArray((compiler as RsbuildCompiler).compilers);
          ctx.logger.debug(
            `[serve] onAfterCreateCompiler: captured ${
              isMulti ? 'MultiCompiler' : 'single Compiler'
            }; watching present at capture=${Boolean((compiler as RsbuildCompiler).watching)}`,
          );
          awaitContextInit(compiler as { hooks?: CompilerHooks });
        });
        api.onBeforeStartDevServer(({ server }) => {
          isServe = true;
          ctx.logger.debug(
            '[serve] onBeforeStartDevServer: registering asset middleware + manifest watcher',
          );
          server.middlewares.use((...args: Parameters<typeof ctx.assetMiddleware>) => {
            ctx.assetMiddleware(...args);
          });

          ctx.logger.debug(
            `[serve] manifest watch paths (${manifestWatchPaths.length}): ${manifestWatchPaths.join(', ') || '<none>'}`,
          );
          const watcher = new ManifestWatcher({
            paths: manifestWatchPaths,
            onChange: () => {
              ctx.logger.debug('[serve] ManifestWatcher.onChange fired, reinitializing');
              return ctx.reinitialize();
            },
            logger: ctx.logger,
          });

          ctx.onReinitialized(() => {
            ctx.logger.debug(
              '[serve] onReinitialized: invalidate compiler + sockWrite("full-reload")',
            );
            invalidateRsbuild(rsbuildCompiler);
            server.sockWrite('full-reload', { path: '*' });
            ctx.logger.debug('[serve] onReinitialized: full-reload sent, handler done');
          });

          watcher.start();
          ctx.logger.debug('[serve] ManifestWatcher started');

          // Dispose on server close
          api.onCloseDevServer(() => {
            ctx.logger.debug('[serve] onCloseDevServer: disposing manifest watcher');
            watcher.dispose();
          });
        });
      },
    },
  };
}
