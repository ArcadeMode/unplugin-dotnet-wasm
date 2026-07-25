import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { ConnectMiddleware } from '../../core/dev-server/asset-middleware';
import { BINARY_EXTENSIONS_REGEX } from '../../core/constants';
import { buildLiteralPathExportModule } from '../../core/asset-resolution/asset-url-module';
import type { PluginContext } from '../context';
import { pathToFileURL } from 'node:url';

type RollupLoadHandlerThis = {
  emitFile(options: { type: string; name: string; source: Buffer }): string;
};

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
