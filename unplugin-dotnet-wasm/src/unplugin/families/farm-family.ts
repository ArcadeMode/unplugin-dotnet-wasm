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

// Farm's compiler exposes the module graph. `traceModuleGraph` lists the real
// module ids in Farm's stored form; `invalidateModule` drops a module's cached
// transform so its `load` hook re-runs. NOTE: never pass a watch-dep path (e.g. a
// manifest) to a graph API — non-module ids panic in the Rust binding.
interface FarmTracedModule {
  id: string;
}
interface FarmCompiler {
  hasModule(resolvedPath: string): boolean;
  traceModuleGraph(): Promise<{ modules: FarmTracedModule[] }>;
  invalidateModule(moduleId: string): void;
}

interface FarmDevServer {
  app(): { use(mw: (ctx: KoaLikeContext, next: () => Promise<void>) => unknown): void };
  // Farm's HMR engine: recompiles the affected modules and pushes the result to clients.
  hmrEngine?: { hmrUpdate(path: string | string[], force?: boolean): Promise<void> };
  // Access to the underlying compiler / module graph.
  getCompiler?(): FarmCompiler | undefined;
  // Underlying node http.Server (present once the dev server is listening).
  server?: { once(event: string, listener: () => void): void };
}

export interface FarmFamilyHooks {
  buildStart(): Promise<void>;
  resolveId(source: string, importer?: string | null): string | null;
  load: {
    filter: { id: RegExp };
    handler(id: string): Promise<string | null>;
  };
  farm: {
    config(userConfig: FarmConfig): Record<string, never>;
    configureDevServer(server: FarmDevServer): void;
  };
}

export function createFarmFamily(ctx: PluginContext): FarmFamilyHooks {
  const farmContentAliases = new Map<string, string>();
  const manifestWatchPaths = getManifestWatchPaths(ctx);
  let isNodeTarget = false;
  // `isServe`: farm dev server (enables the connect middleware + ManifestWatcher).
  // `isWatch`: `farm build --watch` (no dev server; reinit driven from buildStart).
  let isServe = false;
  let isWatch = false;

  // Turn a resolved physical asset path into the id farm should see: a node-target
  // proxy module, a cross-root alias served via `load`, or the physical path itself.
  function finalizePhysicalId(resolved: string): string {
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
  }

  return {
    async buildStart(): Promise<void> {
      await ctx.initialize();
      // No dev server to drive rebuilds: pull manifests in fresh before every (re)build.
      if (isWatch && !isServe) await ctx.reinitialize();
    },
    resolveId(source: string, importer?: string | null): string | null {
      if (importer && importer.endsWith(PROXY_SUFFIX)) {
        // resolving the proxy modules import: let farm resolve the real asset natively (is absolute path).
        return null;
      }

      if (source.endsWith(PROXY_SUFFIX)) {
        return source; // handled by load handler
      }

      // Farm (unlike rollup/vite) re-runs the full resolver when a module is
      // invalidated, resolving it by its own id instead of treating a `\0`-prefixed
      // source as already-resolved. Return our virtual ids unchanged so `load`
      // handles them; otherwise farm's native resolver fails ("Can not resolve").
      if (source.startsWith(VIRTUAL_ROUTE_PREFIX)) {
        return source;
      }

      if (isServe || isWatch) {
        // Give framework JS a fingerprint-independent virtual identity so hash
        // changes don't bake stale paths into farm's module graph. Binaries stay
        // physical (`binaryAsVirtual: false`) and keep their existing farm handling.
        const virtual = resolveVirtualId(ctx, source, importer ?? undefined, {
          binaryAsVirtual: false,
        });
        if (virtual !== null) {
          return virtual.startsWith(VIRTUAL_ROUTE_PREFIX) ? virtual : finalizePhysicalId(virtual);
        }
        // virtual === null: not a framework asset, fall through to physical resolution.
      }

      const resolved = ctx.assetResolver.resolve(source);
      const assetPath = ctx.assetResolver.resolvePath(resolved, source, importer ?? undefined);

      if (isNodeTarget && assetPath !== null) {
        // Node: wrap binary assets in a proxy module (see load handler)
        return toPosixPath(assetPath) + PROXY_SUFFIX;
      }

      if (resolved === null) {
        return null;
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
      // Farm fires this before compilation (buildStart/initialize)
      configureDevServer(server: FarmDevServer): void {
        isServe = true;
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

        // After the resolver is atomically swapped, force farm to recompile the
        // framework modules. `hmrUpdate(manifestPaths)` alone is a no-op: it only
        // queues paths where `compiler.hasModule(path)` is true, and the manifests
        // are watch-deps, not modules. We also can't map manifest -> modules via a
        // graph API (non-module ids panic in the Rust binding). Instead, enumerate
        // the real module ids from the module graph, pick our framework virtual
        // modules by their stable marker, invalidate each (dropping the cached
        // transform so `load` re-runs against the fresh resolver), then hmrUpdate
        // those real ids so farm recompiles + pushes to the browser.
        const FRAMEWORK_MODULE_MARKER = VIRTUAL_ROUTE_PREFIX.slice(1); // 'dotnet-wasm:'
        ctx.onReinitialized(() => {
          const compiler = server.getCompiler?.();
          if (!compiler) {
            // No compiler access: fall back to the (best-effort) manifest trigger.
            void server.hmrEngine?.hmrUpdate(manifestWatchPaths, true);
            return;
          }
          void (async () => {
            try {
              const graph = await compiler.traceModuleGraph();
              const dirty = graph.modules
                .map((m) => m.id)
                .filter((id) => id.includes(FRAMEWORK_MODULE_MARKER));
              ctx.logger.debug(
                `[farm-reload] reinit: ${dirty.length} framework module(s) to invalidate`,
              );
              if (dirty.length === 0) return;
              for (const moduleId of dirty) compiler.invalidateModule(moduleId);
              await server.hmrEngine?.hmrUpdate(dirty, true);
            } catch (error) {
              ctx.logger.error(`[farm-reload] failed to refresh framework modules: ${error}`);
            }
          })();
        });

        const watcher = new ManifestWatcher({
          paths: manifestWatchPaths,
          onChange: () => ctx.reinitialize(),
          logger: ctx.logger,
        });
        watcher.start();
        server.server?.once('close', () => watcher.dispose());
      },
    },
  };
}
