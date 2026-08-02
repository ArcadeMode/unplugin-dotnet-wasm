import { existsSync } from 'node:fs';
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
} from './virtual-resolution';

interface FarmConfig {
  root?: string;
  compilation?: {
    output?: { targetEnv?: string };
    presetEnv?: unknown;
    watch?: boolean | object;
  };
}

interface KoaLikeContext {
  req: IncomingMessage;
  res: ServerResponse;
  respond: boolean;
}

interface FarmCompiler {
  hasModule(resolvedPath: string): boolean;
  modules?(): Array<{ id: string }>;
  resolvedModulePaths(root: string): string[];
  invalidateModule(moduleId: string): void;
  update(paths: string[], sync?: boolean): Promise<unknown>;
  compile(): Promise<void>;
  writeResourcesToDisk(): void;
}

type FarmHmrEngine = { hmrUpdate(path: string | string[], force?: boolean): Promise<void> };

interface FarmDevServer {
  app(): { use(mw: (ctx: KoaLikeContext, next: () => Promise<void>) => unknown): void };
  hmrEngine?: FarmHmrEngine;
  ws?: { clients: Set<{ rawSend(payload: string): void }> };
  server?: { once(event: string, listener: () => void): void };
}

export interface FarmHooks {
  buildStart(): Promise<void>;
  resolveId(source: string, importer?: string): string | null;
  load: {
    filter: { id: RegExp };
    handler(id: string): Promise<string | null>;
  };
  farm: {
    config(userConfig: FarmConfig): Record<string, never>;
    configureCompiler(compiler: FarmCompiler): void;
    configureDevServer(server: FarmDevServer): void;
    updateModules: {
      executor(param: { paths: [string, string][] }): string[] | void;
    };
  };
}

export function createFarm(ctx: PluginContext): FarmHooks {
  const farmContentAliases = new Map<string, string>();
  const manifestWatchPaths = getManifestWatchPaths(ctx);
  let isNodeTarget = false;
  let isServe = false;
  let isWatch = false;
  let compiler: FarmCompiler | undefined;
  let devServer: FarmDevServer | undefined;
  let watcher: ManifestWatcher | undefined;

  function startManifestWatcher(): ManifestWatcher {
    if (watcher) return watcher;
    watcher = new ManifestWatcher({
      paths: manifestWatchPaths,
      onChange: () => {
        ctx.logger.debug('[farm] ManifestWatcher.onChange fired, reinitializing');
        return ctx.reinitialize();
      },
      logger: ctx.logger,
    });
    watcher.start();
    return watcher;
  }

  function collectVirtualModuleIds(): string[] {
    const marker = VIRTUAL_ROUTE_PREFIX.slice(1);
    const seen = new Set<string>();
    const dirty: string[] = [];

    const consider = (id: string): void => {
      if (!id.includes(marker) || seen.has(id) || !compiler?.hasModule(id)) return;
      seen.add(id);
      dirty.push(id);
    };

    if (typeof compiler?.modules === 'function') {
      for (const m of compiler.modules()) consider(m.id);
    } else {
      for (const route of ctx.assetResolver.routes()) {
        const id = resolveVirtualId(ctx, route, undefined, { binaryAs: 'virtualUrlProxy' });
        if (!id?.startsWith(VIRTUAL_ROUTE_PREFIX)) continue;
        consider(id);
        consider(id.slice(1));
      }
      for (const path of compiler?.resolvedModulePaths(ctx.consumerRoot) ?? []) {
        consider(path);
      }
    }
    return dirty;
  }

  async function invalidateModules(): Promise<void> {
    if (!compiler) {
      ctx.logger.debug('[farm-reload] skip invalidate: no compiler');
      return;
    }
    try {
      const dirty = collectVirtualModuleIds();
      ctx.logger.debug(`[farm-reload] reinit: ${dirty.length} virtual module(s) to invalidate`);
      if (dirty.length > 0) {
        for (const moduleId of dirty) compiler.invalidateModule(moduleId);
        await compiler.update(dirty, true);
      } else {
        ctx.logger.debug('[farm-reload] no virtual modules in graph; falling back to compile()');
        await compiler.compile();
      }
      if (isServe) {
        const clients = devServer?.ws?.clients;
        if (clients) for (const client of clients) client.rawSend("{ type: 'full-reload' }");
        ctx.logger.debug(
          `[farm-reload] serve: recompiled + full-reload (${clients?.size ?? 0} client(s))`,
        );
      } else {
        compiler.writeResourcesToDisk();
        ctx.logger.debug('[farm-reload] watch: writeResourcesToDisk completed');
      }
    } catch (error) {
      ctx.logger.error(`[farm-reload] failed to refresh framework modules: ${error}`);
    }
  }

  return {
    async buildStart(): Promise<void> {
      await ctx.initialize();
    },
    resolveId(source: string, importer?: string): string | null {
      if (importer && importer.endsWith(PROXY_SUFFIX)) {
        return null;
      }

      if (source.endsWith(PROXY_SUFFIX) || source.startsWith(VIRTUAL_ROUTE_PREFIX)) {
        return source;
      }

      let resolved: string | null;
      if (isServe || isWatch) {
        resolved = resolveVirtualId(ctx, source, importer, { binaryAs: 'virtualUrlProxy' });
      } else {
        resolved = ctx.assetResolver.resolve(source);
        if (isNodeTarget) {
          const assetPath = ctx.assetResolver.resolvePath(resolved, source, importer ?? undefined);
          if (assetPath !== null) resolved = assetPath;
        }
      }

      if (resolved === null) return null;
      if (resolved.startsWith(VIRTUAL_ROUTE_PREFIX)) return resolved;
      if (isNodeTarget && BINARY_EXTENSIONS_REGEX.test(resolved)) {
        return toPosixPath(resolved) + PROXY_SUFFIX;
      }
      if (parse(resolved).root.toLowerCase() !== parse(ctx.consumerRoot).root.toLowerCase()) {
        farmContentAliases.set(basename(resolved), resolved);
        return join(ctx.consumerRoot, URL_PROXY_NAMESPACE, basename(resolved));
      }
      return resolved;
    },
    load: {
      filter: { id: new RegExp(`${VIRTUAL_ROUTE_ID_REGEX.source}|${URL_PROXY_NAMESPACE}`) },
      async handler(id: string): Promise<string | null> {
        if (id.startsWith(VIRTUAL_ROUTE_PREFIX)) {
          const route = id.slice(VIRTUAL_ROUTE_PREFIX.length);
          ctx.logger.debug(`[farm-reload] load re-run for virtual route "${route}"`);
          const result = await getVirtualizedModuleContent(ctx, route, {
            binaryAs: 'virtualUrlProxy',
          });
          if (result === null) return null;
          return result.code;
        }
        if (id.endsWith(PROXY_SUFFIX)) {
          const real = id.slice(0, -PROXY_SUFFIX.length).replace(/\\/g, '/');
          return buildNewUrlAssetProxyModule(real);
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
        ctx.logger.debug(
          `[farm] config: isWatch=${isWatch} (compilation.watch=${JSON.stringify(userConfig.compilation?.watch)}), ` +
            `isNodeTarget=${isNodeTarget}, manifestWatchPaths=${manifestWatchPaths.length}`,
        );
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
      configureCompiler(c: FarmCompiler): void {
        compiler = c;
        ctx.onReinitialized(invalidateModules);
        ctx.logger.debug(
          `[farm] configureCompiler: isWatch=${isWatch}, startingManifestWatcher=${isWatch}`,
        );
        if (isWatch) startManifestWatcher();
      },
      updateModules: {
        executor({ paths }): string[] {
          const marker = VIRTUAL_ROUTE_PREFIX.slice(1);
          const next = paths
            .map(([p]) => p)
            .filter((p) => {
              if (p.includes(marker) || p.startsWith('\0') || p.endsWith(PROXY_SUFFIX)) return true;
              if (/staticwebassets\.(endpoints|runtime)\.json$/i.test(p)) return false;
              return existsSync(p);
            });
          if (next.length !== paths.length) {
            ctx.logger.debug(
              `[farm-reload] updateModules: dropped ${paths.length - next.length} path(s)`,
            );
          }
          return next;
        },
      },
      configureDevServer(server: FarmDevServer): void {
        isServe = true;
        devServer = server;
        server.app().use(
          (koaCtx, next) =>
            new Promise<void>((resolve, reject) => {
              let handled = true;
              ctx.assetMiddleware(koaCtx.req, koaCtx.res, () => {
                handled = false;
                next().then(resolve, reject);
              });
              if (handled) {
                koaCtx.res.once('finish', resolve);
                koaCtx.res.once('close', resolve);
              }
            }),
        );

        const watcher = startManifestWatcher();
        if (watcher) server.server?.once('close', () => watcher.dispose());
      },
    },
  };
}
