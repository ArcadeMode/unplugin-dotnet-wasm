import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { ConnectMiddleware } from '../../core/dev-server/asset-middleware';
import { BINARY_EXTENSIONS_REGEX } from '../../core/constants';
import { buildLiteralPathExportModule } from '../../core/asset-resolution/asset-url-module';
import { discoverManifests } from '../../core/manifest-parsing/discover';
import { ManifestWatcher } from '../../core/dev-server/manifest-watcher';
import type { PluginContext } from '../context';
import { pathToFileURL } from 'node:url';

type RollupLoadHandlerThis = {
  emitFile(options: { type: string; name: string; source: Buffer }): string;
};

export type ViteServerHookResult = () => void | Promise<void>;

export interface RollupFamilyHooks {
  vite: {
    configResolved(config: { root: string; command: string }): void;
    configureServer(server: {
      middlewares: { use: (fn: ConnectMiddleware) => void };
    }): ViteServerHookResult | void | Promise<void>;
  };
  load: {
    filter: { id: RegExp };
    handler(id: string, options?: { ssr?: boolean }): Promise<string>;
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

export function createRollupFamily(ctx: PluginContext): RollupFamilyHooks {
  let isServe = false;

  return {
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

        const { endpointsManifestPath, runtimeManifestPath } = discoverManifests(ctx.options);
        const paths = [endpointsManifestPath, runtimeManifestPath].filter((p) => p !== null);
        const watcher = new ManifestWatcher({
          paths,
          onChange: () => ctx.reinitialize(),
          logger: ctx.logger,
        });
        ctx.onReinitialized(() => server.ws.send({ type: 'full-reload' }));
        watcher.start();

        server.httpServer?.once('close', () => watcher.dispose());
      },
    },
    load: {
      filter: { id: BINARY_EXTENSIONS_REGEX },
      async handler(
        this: RollupLoadHandlerThis,
        id: string,
        options?: { ssr?: boolean },
      ): Promise<string> {
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
