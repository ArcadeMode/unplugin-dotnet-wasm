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

// The unplugin build context `this` for the `load` hook: `addWatchFile` maps to
// the webpack loader's `this.addDependency`, so a change to the declared
// physical file re-runs this loader (the stable-identity module) — no
// re-resolution of the importer required.
type LoadHandlerContext = { addWatchFile(id: string): void };

type WebpackLikeOptions = {
  context?: string;
  resolve?: { fallback?: Record<string, unknown> };
  module?: { rules?: unknown[] };
  devServer?: Record<string, unknown>;
  watchOptions?: { aggregateTimeout?: number; ignored?: unknown };
};

// Recover the importing virtual module's canonical route from whatever form the
// bundler hands us as the `importer`. webpack passes the raw `\0dotnet-wasm:…`
// id; rspack materializes the virtual module as a real file under
// `node_modules/.virtual/` and passes that on-disk path with the id
// URL-encoded into the filename (e.g. `…/.virtual/%00dotnet-wasm%3A_framework%2Fdotnet.js`).
// Returns the route after the prefix (e.g. `_framework/dotnet.js`), or null.
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
  const isServe = process.env.WEBPACK_SERVE === 'true' || process.argv.includes('serve');
  const binaryRule = { test: FRAMEWORK_BINARY_REGEX, type: 'asset/resource' };
  const jsParserRule = { test: FRAMEWORK_JS_REGEX, parser: { url: false } };
  // Disable webpack/rspack's `new URL()` asset parsing for virtual identifiers
  const virtualJsParserRule = { test: /%00dotnet-wasm%3A/i, parser: { url: false } };

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
    if (physical === null) return null;

    // Declare the current physical file as a dependency: when a fingerprint
    // rebuild relocates it, webpack invalidates THIS stable-identity module and
    // re-runs `load`, which re-resolves to the new physical file.
    loadCtx.addWatchFile(physical);

    if (FRAMEWORK_BINARY_REGEX.test(physical)) {
      return buildReexportAssetModule(physical);
    }

    const code = await readFile(physical, 'utf8');
    return ctx.rewriter.rewrite(code) ?? code;
  }

  // Scoped to virtual ids only: unplugin's webpack `load` rule forces
  // `type: 'javascript/auto'` on every module it is attached to, so without this
  // filter it would misprocess assets and break child compilations.
  const load = {
    filter: { id: VIRTUAL_ROUTE_ID_REGEX },
    handler: async function (this: LoadHandlerContext, id: string): Promise<string | null> {
      if (!id.startsWith(VIRTUAL_ROUTE_PREFIX)) return null;

      const route = id.slice(VIRTUAL_ROUTE_PREFIX.length);
      try {
        return await readVirtualModule(this, route);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        // Missing file _can_ mean that the manifest was updated (e.g. new fingerprints), reinit and try again.
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
        // Nudge webpack to recompile so the virtual framework modules re-run
        // `load` against the freshly reinitialized resolver (relocated assets).
        server.invalidate?.();
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
    if (prepend) opts.module.rules.unshift(binaryRule, jsParserRule, virtualJsParserRule);
    else opts.module.rules.push(binaryRule, jsParserRule, virtualJsParserRule);

    externalizeNodeBuiltins(opts);
  }

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
          const c = compiler as { hooks?: CompilerHooks };
          awaitContextInit(c);
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
