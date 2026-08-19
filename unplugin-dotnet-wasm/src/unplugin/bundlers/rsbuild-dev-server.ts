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

  function invalidateWatching(w: Watching | undefined): void {
    if (!w) return;
    if (typeof w.invalidateWithChangesAndRemovals === 'function') {
      w.invalidateWithChangesAndRemovals(new Set(ctx.manifestPaths), new Set());
    } else if (typeof w.invalidate === 'function') {
      w.invalidate();
    }
  }

  function invalidateRsbuild(compiler: RsbuildCompiler | null): void {
    if (!compiler) return;
    if (Array.isArray(compiler.compilers)) {
      compiler.compilers.forEach((c) => invalidateWatching(c.watching));
    } else {
      invalidateWatching(compiler.watching);
    }
  }

  return {
    setup(api) {
      api.modifyRspackConfig((config) => {
        deps.applyBuildConfig(config, { prepend: true });
      });
      api.onAfterCreateCompiler(({ compiler }) => {
        rsbuildCompiler = compiler as RsbuildCompiler;
        deps.awaitContextInit(compiler as { hooks?: CompilerHooks });
      });
      api.onBeforeStartDevServer(({ server }) => {
        deps.markServe();
        server.middlewares.use((...args: Parameters<typeof ctx.assetMiddleware>) => {
          ctx.assetMiddleware(...args);
        });

        const watcher = new ManifestWatcher({
          paths: ctx.manifestPaths,
          onChange: () => ctx.reinitialize(),
          logger: ctx.logger,
        });

        ctx.onReinitialized(() => {
          invalidateRsbuild(rsbuildCompiler);
          server.sockWrite('full-reload', { path: '*' });
        });

        watcher.start();

        // Dispose on server close
        api.onCloseDevServer(() => {
          watcher.dispose();
        });
      });
    },
  };
}
