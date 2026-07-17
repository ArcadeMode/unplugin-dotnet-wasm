import { readFile } from 'node:fs/promises';
import { basename, parse, join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../context';

// https://www.farmfe.org/docs/api/js-plugin-api#configuredevserver
interface FarmConfig {
  root?: string;
  compilation?: {
    output?: { targetEnv?: string };
    presetEnv?: unknown;
  };
}

// farm's dev server is Koa-like, but not exactly Koa. It has a `respond` property on the context
// https://raw.githubusercontent.com/koajs/koa/master/docs/api/context.md
interface KoaLikeContext {
  req: IncomingMessage;
  res: ServerResponse;
  respond: boolean;
}

// https://www.farmfe.org/docs/features/dev-server
interface FarmDevServer {
  app(): { use(mw: (ctx: KoaLikeContext, next: () => Promise<void>) => unknown): void };
}

export interface FarmFamilyHooks {
  resolveId(source: string): string | null;
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
  const FARM_CONTENT_DIR = '__dotnet_wasm__';
  const farmContentAliases = new Map<string, string>();

  return {
    resolveId(source: string): string | null {
      const resolved = ctx.assetResolver.resolve(source);
      if (resolved === null) return null;
      if (parse(resolved).root.toLowerCase() !== parse(ctx.consumerRoot).root.toLowerCase()) {
        // files are being served from another root (e.g. C:\ while project is on D:\)
        // farm no likey, return alias which we will resolve in `load`
        farmContentAliases.set(basename(resolved), resolved);
        return join(ctx.consumerRoot, FARM_CONTENT_DIR, basename(resolved));
      }
      return resolved;
    },
    load: {
      filter: { id: new RegExp(FARM_CONTENT_DIR) },
      async handler(id: string): Promise<string | null> {
        const real = farmContentAliases.get(basename(id));
        return real === undefined ? null : readFile(real, 'utf-8');
      },
    },
    farm: {
      config(userConfig: FarmConfig): Record<string, never> {
        if (userConfig.root) ctx.setConsumerRoot(userConfig.root);
        const targetEnv = userConfig.compilation?.output?.targetEnv;
        const presetEnv = userConfig.compilation?.presetEnv;
        const polyfillFree = targetEnv === 'browser-esnext' || targetEnv === 'node-next' || presetEnv === false;
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
        server.app().use((koaCtx, next) =>
          new Promise<void>((resolve, reject) => {
            ctx.enableAssetMiddleware();
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
      },
    },
  };
}
