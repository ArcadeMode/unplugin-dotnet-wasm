import type { IncomingMessage, ServerResponse } from 'node:http';
import { ManifestWatcher } from '../../core/dev-server/manifest-watcher';
import type { PluginContext } from '../context';
import type { CompilerHooks } from './webpack-family';

// Subset of the rsbuild `RsbuildDevServer` handed to `onBeforeStartDevServer`.
type RsbuildDevServerInstance = {
  middlewares: {
    use(
      handler: (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void,
    ): void;
  };
  sockWrite(type: string, data?: unknown): void;
};

type Watching = {
  invalidate?: (callback?: () => void) => void;
  invalidateWithChangesAndRemovals?: (changed?: Set<string>, removed?: Set<string>) => void;
};
type RsbuildCompiler = { watching?: Watching; compilers?: { watching?: Watching }[] };

// Subset of the rsbuild plugin `setup` API surface used here.
type RsbuildSetupApi = {
  modifyRspackConfig(fn: (config: unknown) => void): void;
  onAfterCreateCompiler(fn: (ctx: { compiler: unknown }) => void): void;
  onBeforeStartDevServer(fn: (ctx: { server: RsbuildDevServerInstance }) => void): void;
  onCloseDevServer(fn: () => void | Promise<void>): void;
};

export interface RsbuildHooks {
  setup(api: RsbuildSetupApi): void;
}

// Shared plumbing the rsbuild integration borrows from the webpack family.
export interface RsbuildSharedDeps {
  applyBuildConfig(config: unknown, opts?: { prepend?: boolean }): void;
  awaitContextInit(compiler: { hooks?: CompilerHooks }): void;
  markServe(): void;
}

export function createRsbuildSetup(ctx: PluginContext, deps: RsbuildSharedDeps): RsbuildHooks {
  let rsbuildCompiler: RsbuildCompiler | null = null;

  function invalidateWatching(w: Watching | undefined, label: string): void {
    if (!w) {
      ctx.logger.debug(`[serve] invalidate: ${label} has no watching handle`);
      return;
    }
    if (typeof w.invalidateWithChangesAndRemovals === 'function') {
      w.invalidateWithChangesAndRemovals(new Set(ctx.manifestPaths), new Set());
    } else if (typeof w.invalidate === 'function') {
      ctx.logger.debug(`[serve] invalidate: ${label} plain invalidate()`);
      w.invalidate();
    } else {
      ctx.logger.debug(`[serve] invalidate: ${label} exposes no invalidate method`);
    }
  }

  function invalidateRsbuild(compiler: RsbuildCompiler | null): void {
    if (!compiler) {
      ctx.logger.debug('[serve] invalidate: no compiler captured, cannot invalidate');
      return;
    }
    if (Array.isArray(compiler.compilers)) {
      ctx.logger.debug(
        `[serve] invalidate: MultiCompiler with ${compiler.compilers.length} child compiler(s)`,
      );
      compiler.compilers.forEach((c, i) => invalidateWatching(c.watching, `child[${i}]`));
    } else {
      invalidateWatching(compiler.watching, 'single compiler');
    }
  }

  return {
    setup(api) {
      api.modifyRspackConfig((config) => {
        deps.applyBuildConfig(config, { prepend: true });
      });
      api.onAfterCreateCompiler(({ compiler }) => {
        rsbuildCompiler = compiler as RsbuildCompiler;
        const isMulti = Array.isArray((compiler as RsbuildCompiler).compilers);
        ctx.logger.debug(
          `[serve] onAfterCreateCompiler: captured ${
            isMulti ? 'MultiCompiler' : 'single Compiler'
          }; watching present at capture=${Boolean((compiler as RsbuildCompiler).watching)}`,
        );
        deps.awaitContextInit(compiler as { hooks?: CompilerHooks });
      });
      api.onBeforeStartDevServer(({ server }) => {
        deps.markServe();
        ctx.logger.debug(
          '[serve] onBeforeStartDevServer: registering asset middleware + manifest watcher',
        );
        server.middlewares.use((...args: Parameters<typeof ctx.assetMiddleware>) => {
          ctx.assetMiddleware(...args);
        });

        ctx.logger.debug(
          `[serve] manifest watch paths (${ctx.manifestPaths.length}): ${ctx.manifestPaths.join(', ') || '<none>'}`,
        );
        const watcher = new ManifestWatcher({
          paths: ctx.manifestPaths,
          onChange: () => {
            ctx.logger.debug('[serve] ManifestWatcher.onChange fired, reinitializing');
            return ctx.reinitialize();
          },
          logger: ctx.logger,
        });

        ctx.onReinitialized(() => {
          ctx.logger.debug(
            '[serve] onReinitialized: invalidate compiler + sockWrite("full-reload")',
          );
          invalidateRsbuild(rsbuildCompiler);
          server.sockWrite('full-reload', { path: '*' });
          ctx.logger.debug('[serve] onReinitialized: full-reload sent, handler done');
        });

        watcher.start();
        ctx.logger.debug('[serve] ManifestWatcher started');

        // Dispose on server close
        api.onCloseDevServer(() => {
          ctx.logger.debug('[serve] onCloseDevServer: disposing manifest watcher');
          watcher.dispose();
        });
      });
    },
  };
}
