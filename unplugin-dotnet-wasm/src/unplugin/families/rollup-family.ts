import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { ConnectMiddleware } from '../../core/dev-server/asset-middleware';
import { createAssetMiddleware } from '../../core/dev-server/asset-middleware';
import { BINARY_EXTENSIONS_REGEX } from '../../core/constants';
import type { PluginContext } from '../context';

export interface RollupFamilyHooks {
  vite: {
    configResolved(config: { root: string; command: string }): void;
    configureServer(server: {
      middlewares: { use: (fn: ConnectMiddleware) => void };
    }): void;
  };
  load: {
    filter: { id: RegExp };
    handler(id: string): Promise<string>;
  };
}

export function createRollupFamily(ctx: PluginContext): RollupFamilyHooks {
  return {
    vite: {
      configResolved(config: { root: string; command: string }): void {
        ctx.consumerRoot = config.root;
        ctx.isServe = config.command === 'serve';
      },
      configureServer(server: {
        middlewares: { use: (fn: ConnectMiddleware) => void };
      }): void {
        server.middlewares.use((req, res, next) => {
          if (!ctx.assetResolver) return next();
          ctx.assetMiddleware ??= createAssetMiddleware(ctx.assetResolver, ctx.logger);
          ctx.assetMiddleware(req, res, next);
        });
      },
    },
    load: {
      filter: { id: BINARY_EXTENSIONS_REGEX },
      async handler(this: { emitFile(options: { type: string; name: string; source: Buffer }): string }, id: string): Promise<string> {
        // Dev/serve: return an explicit middleware route so the dotnet runtime
        // fetches our handler (independent of scriptDirectory) instead of
        // falling back to Vite's /@fs/ static handler.
        if (ctx.isServe) {
          return `export default ${JSON.stringify('/_framework/' + basename(id))};`;
        }
        // Build: emit via Rollup's asset API; the placeholder is rewritten to
        // the final hashed URL at bundle time.
        const source = await readFile(id);
        const refId = this.emitFile({ type: 'asset', name: basename(id), source });
        return `export default import.meta.ROLLUP_FILE_URL_${refId};`;
      },
    },
  };
}
