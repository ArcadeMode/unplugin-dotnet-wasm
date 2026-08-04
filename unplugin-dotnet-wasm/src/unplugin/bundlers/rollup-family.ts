import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ConnectMiddleware } from '../../core/dev-server/asset-middleware';
import { BINARY_EXTENSIONS_REGEX, VIRTUAL_ROUTE_ID_REGEX } from '../../core/constants';
import { buildLiteralPathExportModule } from '../../core/asset-resolution/asset-url-module';
import { isVirtualId, routeFromVirtualId } from '../../core/asset-resolution/virtual-id';
import { ManifestWatcher } from '../../core/dev-server/manifest-watcher';
import type { PluginContext } from '../context';
import type { LoadHandlerContext } from './load-context';

type RollupLoadThis = LoadHandlerContext & {
  emitFile(options: { type: 'asset'; name: string; source: Buffer }): string;
};

export type ViteServerHookResult = () => void | Promise<void>;

export interface RollupFamilyHooks {
  buildStart(this: unknown): Promise<void>;
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

type ViteModuleGraphLike = {
  idToModuleMap: Map<string, unknown>;
  invalidateModule: (mod: unknown) => void;
};

export function createRollupFamily(ctx: PluginContext): RollupFamilyHooks {
  // `isServe`: vite dev server or vitest (controls middleware)
  // `isWatch`: watch modes (also true with dev server)
  let isServe = false;
  let isWatch = false;

  function invalidateAllVirtualModules(server: ViteDevServer): void {
    const graph = (server as { moduleGraph?: ViteModuleGraphLike }).moduleGraph;
    if (!graph) return;
    for (const [id, mod] of graph.idToModuleMap) {
      if (isVirtualId(id)) graph.invalidateModule(mod);
    }
  }

  function resolveId(source: string, importer?: string): string | null {
    const virtualize = isWatch || isServe;
    return virtualize
      ? ctx.virtualModules.resolveId(source, importer)
      : ctx.assetResolver.resolve(source);
  }

  return {
    async buildStart(this: object): Promise<void> {
      ctx.logger.debug(`[build] buildStart invoked in rollup-family`);
      isWatch = (this as { meta?: { watchMode?: boolean } })?.meta?.watchMode ?? false;
      await ctx.initialize();
      if (isWatch && !isServe) {
        // No dev server to control rebuilds, ensure manifests pulled in before every (re)build
        await ctx.reinitialize();
      }
      ctx.logger.debug(`[build] buildStart completed: isWatch=${isWatch}, isServe=${isServe}`);
    },
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
        ctx.onReinitialized(() => {
          invalidateAllVirtualModules(server);
          server.ws.send({ type: 'full-reload' });
        });

        const watcher = new ManifestWatcher({
          paths: ctx.manifestPaths,
          onChange: () => {
            ctx.logger.debug('[serve] ManifestWatcher.onChange fired, reinitializing');
            return ctx.reinitialize();
          },
          logger: ctx.logger,
        });
        watcher.start();
        server.httpServer?.once('close', () => watcher.dispose());
      },
    },
    load: {
      filter: {
        id: new RegExp(`${VIRTUAL_ROUTE_ID_REGEX.source}|${BINARY_EXTENSIONS_REGEX.source}`),
      },
      async handler(
        this: RollupLoadThis,
        id: string,
        options?: { ssr?: boolean },
      ): Promise<string | null> {
        const route = routeFromVirtualId(id);
        if (route !== null) {
          ctx.logger.debug(`[load] virtual module load: ${id}`);
          const result = await ctx.loadContent(route);
          if (result === null) return null;
          for (const watchPath of [result.path, ...ctx.manifestPaths]) this.addWatchFile(watchPath);
          return result.code;
        }
        // else: Framework binaries (see filter)
        if (isServe) {
          const exportPath = options?.ssr
            ? pathToFileURL(id).href // Node dev server (e.g. Vitest): no HTTP origin, so hand back an absolute file:// URL.
            : '/_framework/' + basename(id); // Browser dev server: page origin + connect middleware serve /_framework/*.
          ctx.logger.debug(`[load] framework binary load: ${id} => ${exportPath}`);
          return buildLiteralPathExportModule(exportPath);
        } else {
          const source = await readFile(id);
          const refId = this.emitFile({ type: 'asset', name: basename(id), source });
          return `export default import.meta.ROLLUP_FILE_URL_${refId};`;
        }
      },
    },
  };
}
