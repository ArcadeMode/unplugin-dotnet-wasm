import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ConnectMiddleware } from '../../core/dev-server/asset-middleware';
import {
  BINARY_EXTENSIONS_REGEX,
  VIRTUAL_ROUTE_ID_REGEX,
  VIRTUAL_ROUTE_PREFIX,
} from '../../core/constants';
import { buildLiteralPathExportModule } from '../../core/asset-resolution/asset-url-module';
import { ManifestWatcher } from '../../core/dev-server/manifest-watcher';
import type { PluginContext } from '../context';
import {
  getManifestWatchPaths,
  readVirtualModuleGuarded,
  resolveVirtualId,
  type LoadHandlerContext,
} from './virtual-resolution';

// The `load` hook `this` for the rollup family: rollup's `emitFile` (build mode)
// plus `addWatchFile` (dev virtual modules).
type RollupLoadThis = LoadHandlerContext & {
  emitFile(options: { type: 'asset'; name: string; source: Buffer }): string;
};

export type ViteServerHookResult = () => void | Promise<void>;

export interface RollupFamilyHooks {
  resolveId(source: string, importer?: string): string | null;
  vite: {
    configResolved(config: { root: string; command: string }): void;
    configureServer(server: ViteDevServer): ViteServerHookResult | void | Promise<void>;
  };
  load: {
    filter: { id: RegExp };
    handler(id: string, options?: { ssr?: boolean }): Promise<string | null>;
  };
}

export interface ViteWatcher {
  add: (paths: string | readonly string[]) => ViteWatcher;
}

export interface ViteMiddlewares {
  use: (fn: ConnectMiddleware) => void;
}

export interface ViteDevServer {
  middlewares: ViteMiddlewares;
  watcher: ViteWatcher;
  ws: { send: (payload: { type: string }) => void };
  httpServer?: { once: (event: string, listener: () => void) => void } | null;
}

// Minimal structural view of vite's ModuleGraph — enough to drop cached
// transforms of the framework virtual modules (which have no file mtime for vite
// to key off). Accessed via a cast so ViteDevServer stays a clean supertype of
// vite's real server type.
type ViteModuleGraphLike = {
  idToModuleMap: Map<string, unknown>;
  invalidateModule: (mod: unknown) => void;
};

// Matches the framework virtual ids AND the physical binary paths this family's
// `load` hook is responsible for.
const LOAD_FILTER = new RegExp(
  `${VIRTUAL_ROUTE_ID_REGEX.source}|${BINARY_EXTENSIONS_REGEX.source}`,
);

export function createRollupFamily(ctx: PluginContext): RollupFamilyHooks {
  let isServe = false;
  const manifestWatchPaths = getManifestWatchPaths(ctx);

  // Virtual framework modules carry no file mtime, so vite won't drop their
  // cached transform when the underlying fingerprinted file moves. Invalidate
  // them explicitly before a reload so the page re-resolves to the new physical.
  function invalidateVirtualModules(server: ViteDevServer): void {
    const graph = (server as { moduleGraph?: ViteModuleGraphLike }).moduleGraph;
    if (!graph) return;
    for (const [id, mod] of graph.idToModuleMap) {
      if (id.startsWith(VIRTUAL_ROUTE_PREFIX)) graph.invalidateModule(mod);
    }
  }

  function resolveId(source: string, importer?: string): string | null {
    if (!isServe) return ctx.assetResolver.resolve(source);
    // Binaries stay physical so the existing connect-middleware `load` path serves them.
    return resolveVirtualId(ctx, source, importer, { binaryAsVirtual: false });
  }

  return {
    resolveId,
    vite: {
      configResolved(config: { root: string; command: string }): void {
        ctx.setConsumerRoot(config.root);
        isServe = config.command === 'serve';
      },
      configureServer(server: ViteDevServer): ViteServerHookResult | void | Promise<void> {
        server.middlewares.use((...args: Parameters<typeof ctx.assetMiddleware>) =>
          ctx.assetMiddleware(...args),
        );
        ctx.onInitialized(() => {
          server.watcher.add(ctx.assetResolver.roots());
        });

        const watcher = new ManifestWatcher({
          paths: manifestWatchPaths,
          onChange: () => ctx.reinitialize(),
          logger: ctx.logger,
        });
        ctx.onReinitialized(() => {
          invalidateVirtualModules(server);
          server.ws.send({ type: 'full-reload' });
        });
        watcher.start();
        server.httpServer?.once('close', () => watcher.dispose());
      },
    },
    load: {
      filter: { id: LOAD_FILTER },
      async handler(
        this: RollupLoadThis,
        id: string,
        options?: { ssr?: boolean },
      ): Promise<string | null> {
        // Virtual framework JS: re-resolve to the current physical file + rewrite (dev only).
        if (id.startsWith(VIRTUAL_ROUTE_PREFIX)) {
          const route = id.slice(VIRTUAL_ROUTE_PREFIX.length);
          return readVirtualModuleGuarded(ctx, this, route, manifestWatchPaths);
        }

        // Framework binaries.
        if (isServe) {
          const exportPath = options?.ssr
            ? pathToFileURL(id).href // Node dev server (e.g. Vitest): no HTTP origin, so hand back an absolute file:// URL.
            : '/_framework/' + basename(id); // Browser dev server: page origin + connect middleware serve /_framework/*.
          return buildLiteralPathExportModule(exportPath);
        }
        const source = await readFile(id);
        const refId = this.emitFile({ type: 'asset', name: basename(id), source });
        return `export default import.meta.ROLLUP_FILE_URL_${refId};`;
      },
    },
  };
}
