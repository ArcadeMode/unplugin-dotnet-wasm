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

interface FarmDevServer {
  app(): { use(mw: (ctx: KoaLikeContext, next: () => Promise<void>) => unknown): void };
  // Farm's HMR engine: recompiles the affected modules and pushes the result to clients.
  hmrEngine?: { hmrUpdate(path: string | string[], force?: boolean): Promise<void> };
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
        // framework modules (they declared the manifests as watch deps) and push
        // the fresh output to the browser.
        ctx.onReinitialized(() => {
          void server.hmrEngine?.hmrUpdate(manifestWatchPaths, true);
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
