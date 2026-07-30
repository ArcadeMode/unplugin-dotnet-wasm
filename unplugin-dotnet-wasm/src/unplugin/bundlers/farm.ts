import { readFile } from 'node:fs/promises';
import { basename, parse, join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  PROXY_SUFFIX,
  URL_PROXY_NAMESPACE,
  VIRTUAL_ROUTE_ID_REGEX,
  VIRTUAL_ROUTE_PREFIX,
  BINARY_EXTENSIONS_REGEX,
} from '../../core/constants';
import { buildNewUrlAssetProxyModule } from '../../core/asset-resolution/asset-url-module';
import { ManifestWatcher } from '../../core/dev-server/manifest-watcher';
import type { PluginContext } from '../context';
import { toPosixPath } from '../../core/path-utils';
import {
  getManifestWatchPaths,
  getVirtualizedModuleContent,
  resolveVirtualId,
  type LoadHandlerContext,
} from './virtual-resolution';

interface FarmConfig {
  root?: string;
  compilation?: {
    output?: { targetEnv?: string };
    presetEnv?: unknown;
    watch?: boolean | object;
  };
}

// farm's dev-server context is Koa-like (carries a `respond` flag), but not exactly Koa.
interface KoaLikeContext {
  req: IncomingMessage;
  res: ServerResponse;
  respond: boolean;
}

interface FarmTracedModule {
  id: string;
}
interface FarmCompiler {
  hasModule(resolvedPath: string): boolean;
  traceModuleGraph(): Promise<{ modules: FarmTracedModule[] }>;
  invalidateModule(moduleId: string): void;
  update(paths: string[], sync?: boolean): Promise<unknown>;
  writeResourcesToDisk(): void;
}

// Farm's HMR engine: recompiles the affected modules and pushes the result to clients.
type FarmHmrEngine = { hmrUpdate(path: string | string[], force?: boolean): Promise<void> };

interface FarmDevServer {
  app(): { use(mw: (ctx: KoaLikeContext, next: () => Promise<void>) => unknown): void };
  hmrEngine?: FarmHmrEngine;
  // Underlying node http.Server (present once the dev server is listening).
  server?: { once(event: string, listener: () => void): void };
}

export interface FarmHooks {
  buildStart(): Promise<void>;
  resolveId(source: string, importer?: string): string | null;
  load: {
    filter: { id: RegExp };
    handler(id: string): Promise<string | null>;
  };
  farm: {
    config(userConfig: FarmConfig): Record<string, never>;
    configureCompiler(compiler: FarmCompiler): void;
    configureDevServer(server: FarmDevServer): void;
  };
}

export function createFarm(ctx: PluginContext): FarmHooks {
  const farmContentAliases = new Map<string, string>();
  const manifestWatchPaths = getManifestWatchPaths(ctx);
  let isNodeTarget = false;
  let isServe = false;
  let isWatch = false;
  let compiler: FarmCompiler | undefined;
  let hmrEngine: FarmHmrEngine | undefined;
  let watcher: ManifestWatcher | undefined;

  // The stable marker shared by all our framework virtual module ids.

  function startManifestWatcher(): ManifestWatcher {
    if (watcher) return watcher;
    watcher = new ManifestWatcher({
      paths: manifestWatchPaths,
      onChange: () => ctx.reinitialize(),
      logger: ctx.logger,
    });
    watcher.start();
    return watcher;
  }

  async function invalidateModules(): Promise<void> {
    if (!compiler) return;
    try {
      const graph = await compiler.traceModuleGraph();
      const dirty = graph.modules
        .map((m) => m.id)
        .filter((id) => id.includes(VIRTUAL_ROUTE_PREFIX.slice(1))); // split the leading null byte, module graph ids are encoded
      ctx.logger.debug(`[farm-reload] reinit: ${dirty.length} framework module(s) to invalidate`);
      if (dirty.length === 0) return;
      for (const moduleId of dirty) compiler.invalidateModule(moduleId);
      if (hmrEngine) {
        await hmrEngine.hmrUpdate(dirty, true);
      } else {
        await compiler.update(dirty, true);
        compiler.writeResourcesToDisk();
      }
    } catch (error) {
      ctx.logger.error(`[farm-reload] failed to refresh framework modules: ${error}`);
    }
  }

  return {
    async buildStart(): Promise<void> {
      await ctx.initialize();
      // No dev server to drive rebuilds: pull manifests in fresh before every (re)build.
      if (isWatch && !isServe) await ctx.reinitialize();
    },
    resolveId(source: string, importer?: string): string | null {
      if (importer && importer.endsWith(PROXY_SUFFIX)) {
        // resolving the proxy modules import: let farm resolve the real asset natively (is absolute path).
        return null;
      }

      // Farm wonks out sometimes and re-resolves virtual ids / inserted proxy modules
      if (source.endsWith(PROXY_SUFFIX) || source.startsWith(VIRTUAL_ROUTE_PREFIX)) {
        // Lets `load` handle
        return source;
      }

      let resolved: string | null;
      if (isServe || isWatch) {
        // virtualize to hide fingerprints from farm's module graph
        resolved = resolveVirtualId(ctx, source, importer, { binaryAsVirtual: false });
      } else {
        resolved = ctx.assetResolver.resolve(source);
        if (isNodeTarget) {
          const assetPath = ctx.assetResolver.resolvePath(resolved, source, importer ?? undefined);
          if (assetPath !== null) resolved = assetPath;
        }
      }

      if (resolved === null) return null;
      // Virtual ids are handled by `load`; return them untouched.
      if (resolved.startsWith(VIRTUAL_ROUTE_PREFIX)) return resolved;
      if (isNodeTarget && BINARY_EXTENSIONS_REGEX.test(resolved)) {
        // Node: wrap binary assets in a proxy module (see load handler)
        return toPosixPath(resolved) + PROXY_SUFFIX;
      }
      if (parse(resolved).root.toLowerCase() !== parse(ctx.consumerRoot).root.toLowerCase()) {
        // cross-root asset (e.g. C:\ vs D:\): farm can't resolve it, alias + serve via `load`.
        farmContentAliases.set(basename(resolved), resolved);
        return join(ctx.consumerRoot, URL_PROXY_NAMESPACE, basename(resolved));
      }
      return resolved;
    },
    load: {
      filter: { id: new RegExp(`${VIRTUAL_ROUTE_ID_REGEX.source}|${URL_PROXY_NAMESPACE}`) },
      async handler(this: LoadHandlerContext, id: string): Promise<string | null> {
        if (id.startsWith(VIRTUAL_ROUTE_PREFIX)) {
          // Framework JS virtual module: re-resolve to the current physical file,
          // register it (+ the manifests) as watch deps, and rewrite its contents.
          const route = id.slice(VIRTUAL_ROUTE_PREFIX.length);
          ctx.logger.debug(`[farm-reload] load re-run for virtual route "${route}"`);
          return getVirtualizedModuleContent(ctx, this, route, manifestWatchPaths);
        }
        if (id.endsWith(PROXY_SUFFIX)) {
          const real = id.slice(0, -PROXY_SUFFIX.length).replace(/\\/g, '/');
          return buildNewUrlAssetProxyModule(real); // return the actual proxy module
        }
        const real = farmContentAliases.get(basename(id));
        return real === undefined ? null : readFile(real, 'utf-8');
      },
    },
    farm: {
      config(userConfig: FarmConfig): Record<string, never> {
        if (userConfig.root) ctx.setConsumerRoot(userConfig.root);
        const targetEnv = userConfig.compilation?.output?.targetEnv;
        isNodeTarget = typeof targetEnv === 'string' && targetEnv.startsWith('node');
        isWatch = Boolean(userConfig.compilation?.watch);
        const presetEnv = userConfig.compilation?.presetEnv;
        const polyfillFree =
          targetEnv === 'browser-esnext' || targetEnv === 'node-next' || presetEnv === false;
        if (!polyfillFree) {
          ctx.logger.warn(
            `The configured compilation.output.targetEnv (${targetEnv ?? 'browser-es2017'}) enables preset-env polyfill injection, ` +
              `which requires 'core-js' to be installed. Alternatively set compilation.output.targetEnv: 'browser-esnext' | 'node-next' ` +
              `to skip polyfills.`,
          );
        }
        return {};
      },
      configureCompiler(c: FarmCompiler): void {
        compiler = c;
        ctx.onReinitialized(invalidateModules);
        if (isWatch) startManifestWatcher();
      },
      // Fires after the dev server + HMR engine are ready (serve only).
      configureDevServer(server: FarmDevServer): void {
        isServe = true;
        hmrEngine = server.hmrEngine;
        server.app().use(
          (koaCtx, next) =>
            new Promise<void>((resolve, reject) => {
              let handled = true;
              ctx.assetMiddleware(koaCtx.req, koaCtx.res, () => {
                handled = false; // unhandled by middleware
                next().then(resolve, reject);
              });
              if (handled) {
                koaCtx.res.once('finish', resolve);
                koaCtx.res.once('close', resolve);
              }
            }),
        );

        const watcher = startManifestWatcher();
        if (watcher) server.server?.once('close', () => watcher.dispose());
      },
    },
  };
}
