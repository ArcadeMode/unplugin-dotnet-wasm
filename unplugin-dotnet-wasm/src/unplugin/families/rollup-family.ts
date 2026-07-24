import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ConnectMiddleware } from '../../core/dev-server/asset-middleware';
import { BINARY_EXTENSIONS_REGEX } from '../../core/constants';
import type { PluginContext } from '../context';

export interface RollupFamilyHooks {
  vite: {
    configResolved(config: { root: string; command: string }): void;
    configureServer(server: { middlewares: { use: (fn: ConnectMiddleware) => void } }): void;
  };
  load: {
    filter: { id: RegExp };
    handler(id: string, options?: { ssr?: boolean }): Promise<string>;
  };
}

export function createRollupFamily(ctx: PluginContext): RollupFamilyHooks {
  let isServe = false;

  return {
    vite: {
      configResolved(config: { root: string; command: string }): void {
        ctx.setConsumerRoot(config.root);
        isServe = config.command === 'serve';
      },
      configureServer(server: { middlewares: { use: (fn: ConnectMiddleware) => void } }): void {
        server.middlewares.use((req, res, next) => {
          ctx.enableAssetMiddleware();
          ctx.assetMiddleware(req, res, next);
        });
      },
    },
    load: {
      filter: { id: BINARY_EXTENSIONS_REGEX },
      async handler(
        this: { emitFile(options: { type: string; name: string; source: Buffer }): string },
        id: string,
        options?: { ssr?: boolean },
      ): Promise<string> {
        if (isServe) {
          // Node dev server (e.g. Vitest in node env): no HTTP origin/port is available, so
          // hand the runtime an absolute file:// URL to the physical asset. `id` is already the
          // resolved physical path (resolveId mapped it via the VFS).
          if (options?.ssr) {
            return `export default ${JSON.stringify(pathToFileURL(id).href)};`;
          }
          // Browser dev server: the page origin resolves /_framework/* and the connect
          // middleware streams it. Serve directly instead of falling back to default /@fs/.
          return `export default ${JSON.stringify('/_framework/' + basename(id))};`;
        }
        const source = await readFile(id);
        const refId = this.emitFile({ type: 'asset', name: basename(id), source });
        return `export default import.meta.ROLLUP_FILE_URL_${refId};`;
      },
    },
  };
}
