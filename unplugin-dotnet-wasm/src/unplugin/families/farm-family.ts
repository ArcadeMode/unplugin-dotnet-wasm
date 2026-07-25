import { readFile } from 'node:fs/promises';
import { basename, parse, join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PROXY_SUFFIX, URL_PROXY_NAMESPACE } from '../../core/constants';
import { buildNewUrlAssetProxyModule } from '../../core/asset-resolution/asset-url-module';
import type { PluginContext } from '../context';
import { toPosixPath } from '../../core/path-utils';

interface FarmConfig {
  root?: string;
  compilation?: {
    output?: { targetEnv?: string };
    presetEnv?: unknown;
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
}

export interface FarmFamilyHooks {
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
  let isNodeTarget = false;

  return {
    resolveId(source: string, importer?: string | null): string | null {
      // resolving the proxy modules import: let farm resolve the real asset natively.
      if (importer && importer.endsWith(PROXY_SUFFIX)) return null;
      if (source.endsWith(PROXY_SUFFIX)) return source;

      const resolved = ctx.assetResolver.resolve(source);
      const assetPath = ctx.assetResolver.resolvePath(resolved, source, importer ?? undefined);

      // Node: wrap binary assets in a proxy module (see load handler)
      if (isNodeTarget && assetPath !== null) {
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
      filter: { id: new RegExp(`${URL_PROXY_NAMESPACE}`) },
      async handler(id: string): Promise<string | null> {
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
        server.app().use(
          (koaCtx, next) =>
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
