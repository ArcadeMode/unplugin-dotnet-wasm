import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  FRAMEWORK_BINARY_REGEX,
  FRAMEWORK_JS_REGEX,
  DOTNET_NODE_BUILTINS,
} from '../../core/constants';
import type { PluginContext } from '../context';

type CompilerHooks = {
  beforeRun: { tapPromise(name: string, fn: () => Promise<void>): void };
  watchRun: { 
    tapPromise(name: string, fn: () => Promise<void>): void,
    tapAsync(name: string, fn: (compiler: { modifiedFiles?: Iterable<string> }, callback: () => void) => void): void
   };
  thisCompilation: {
    tap(
      name: string,
      fn: (compilation: { contextDependencies: { add(dir: string): void } }) => void,
    ): void;
  };
  afterEnvironment: {
    tap(name: string, fn: () => void): void;
  };

};

type WebpackCompiler = {
  options: { context?: string; module?: { rules?: unknown[] } };
  hooks: CompilerHooks;
  watchFileSystem: {
    watch(
      files: Iterable<string>,
      dirs: Iterable<string>,
      missing: Iterable<string>,
      startTime: number,
      options: unknown,
      callback: (err?: unknown, timeInfoEntries1?: Map<string, unknown> | undefined, timeInfoEntries2?: Map<string, unknown> | undefined, changes?: Set<string> | undefined, removals?: Set<string> | undefined) => void,
      undelayed: (fileName: string, changeTime: number) => void,
    ): void;
  } | null;
};

export interface WebpackFamilyHooks {
  webpack(compiler: WebpackCompiler): void;
  rspack(compiler: WebpackCompiler): void;
  rsbuild: {
    setup(api: {
      modifyRspackConfig(fn: (config: unknown) => void): void;
      onAfterCreateCompiler(fn: (ctx: { compiler: unknown }) => void): void;
      onBeforeStartDevServer(
        fn: (ctx: {
          server: {
            middlewares: {
              use(
                handler: (
                  req: IncomingMessage,
                  res: ServerResponse,
                  next: (err?: unknown) => void,
                ) => void,
              ): void;
            };
          };
        }) => void,
      ): void;
    }): void;
  };
}

type WebpackLikeOptions = {
  context?: string;
  resolve?: { fallback?: Record<string, unknown> };
  module?: { rules?: unknown[] };
  devServer?: Record<string, unknown>;
  watchOptions?: { aggregateTimeout?: number; ignored?: unknown };
};

export function createWebpackFamily(ctx: PluginContext): WebpackFamilyHooks {
  // webpack-cli sets WEBPACK_SERVE; @rspack/cli does not, but its argv contains "serve".
  const isServe = process.env.WEBPACK_SERVE === 'true' || process.argv.includes('serve');

  const binaryRule = { test: FRAMEWORK_BINARY_REGEX, type: 'asset/resource' };
  const jsParserRule = { test: FRAMEWORK_JS_REGEX, parser: { url: false } };

  function externalizeNodeBuiltins(opts: WebpackLikeOptions): void {
    opts.resolve ??= {};
    opts.resolve.fallback ??= {};
    for (const mod of DOTNET_NODE_BUILTINS) {
      if (!(mod in opts.resolve.fallback)) {
        opts.resolve.fallback[mod] = false;
      }
    }
  }

  // unplugin's buildStart isn't awaited for this family (resolve begins before initialization completes)
  // workaround: https://github.com/unjs/unplugin/issues/293
  function awaitContextInit(compiler: { hooks?: CompilerHooks }): void {
    compiler.hooks?.beforeRun?.tapPromise('unplugin-dotnet-wasm', () => ctx.initialize());
    compiler.hooks?.watchRun?.tapPromise('unplugin-dotnet-wasm', () => ctx.initialize());
  }

  function registerDevServerMiddleware(compiler: { options: WebpackLikeOptions }): void {
    if (!isServe) return;

    compiler.options.devServer ??= {};
    const devServerConfig = compiler.options.devServer as Record<string, unknown>;
    const existingSetup = devServerConfig.setupMiddlewares as
      ((middlewares: unknown[], devServer: unknown) => unknown[]) | undefined;

    devServerConfig.setupMiddlewares = (middlewares: unknown[], devServer: unknown): unknown[] => {
      const assetMiddlewareEntry = {
        name: 'unplugin-dotnet-wasm',
        middleware: (...args: Parameters<typeof ctx.assetMiddleware>) => {
          ctx.assetMiddleware(...args);
        },
      };
      middlewares.unshift(assetMiddlewareEntry);

      if (existingSetup) {
        return existingSetup(middlewares, devServer);
      }
      return middlewares;
    };
  }

  function applyBuildConfig(config: unknown, { prepend = false } = {}): void {
    const opts = config as WebpackLikeOptions;
    if (opts.context) ctx.setConsumerRoot(opts.context);
    opts.module ??= { rules: [] };
    opts.module.rules ??= [];
    if (prepend) opts.module.rules.unshift(binaryRule, jsParserRule);
    else opts.module.rules.push(binaryRule, jsParserRule);
    
    // Ensure minimal aggregateTimeout for watch mode to cope with MSBuild file writes
    // opts.watchOptions = opts.watchOptions || {};
    // const currentTimeout = opts.watchOptions.aggregateTimeout || 0;
    // opts.watchOptions.aggregateTimeout = Math.max(currentTimeout, 500);

    externalizeNodeBuiltins(opts);
  }

  function watchContentRoots(compiler: { hooks?: CompilerHooks, watchFileSystem?: WebpackCompiler['watchFileSystem'] }): void {
    if (!isServe) return;

    compiler.hooks?.thisCompilation.tap('unplugin-dotnet-wasm', (compilation) => {
      ctx.onInitialized(() => {
        for (const root of ctx.assetResolver.roots()) {
          compilation.contextDependencies.add(root);
        }
      });
    });
    console.log('watchContentRoots: registering watchFileSystem interceptor in afterEnvironment');

    let timer: NodeJS.Timeout | null = null;

    compiler.hooks?.afterEnvironment.tap('unplugin-dotnet-wasm', () => {
      if (!compiler.watchFileSystem) {
        ctx.logger.warn('compiler.watchFileSystem is undefined; skipping .NET file watching setup.');
        return;
      }

      const wfs = compiler.watchFileSystem as any;
      const origWatch = wfs.watch.bind(wfs);

      let dotnetTimer: NodeJS.Timeout | null = null;

      wfs.watch = (
        files: string[],
        dirs: string[],
        missing: string[],
        startTime: number,
        options: any,
        callback: Function,
        undelayed: Function
      ) => {
        // // 1. Execute original watch to initialize Watchpack
        // const watcher = origWatch(files, dirs, missing, startTime, options, callback, undelayed);

        // // 2. Access the internal Watchpack instance created by NodeWatchFileSystem
        // const watchpack = wfs.watcher;

        // if (watchpack && !watchpack._dotnetIntercepted) {
        //   watchpack._dotnetIntercepted = true; // Prevent duplicate patching on re-watches

        //   const originalEmit = watchpack.emit.bind(watchpack);
        //   const roots = ctx.assetResolver.roots();

        //   watchpack.emit = function (...args: any[]) {
        //     const [event, filePath, mtime, explanation] = args;
        //     // Intercept file-level changes or removals
        //     if ((event === 'change' || event === 'remove') && typeof filePath === 'string') {
        //       const isDotnetEvent = roots.some(root => filePath.startsWith(root));

        //       if (isDotnetEvent) {
        //         ctx.logger.info(`[unplugin-dotnet-wasm] .NET file write detected: ${filePath}`);

        //         if (dotnetTimer) {
        //           clearTimeout(dotnetTimer);
        //         }

        //         // Buffer .NET events until MSBuild output stabilizes
        //         dotnetTimer = setTimeout(() => {
        //           dotnetTimer = null;
        //           ctx.logger.info('[unplugin-dotnet-wasm] .NET asset writes quieted down, firing Webpack watcher event...');
        //           // const inputFs = (compiler as any).inputFileSystem;
        //           // if (inputFs && typeof inputFs.purge === 'function') {
        //           //   inputFs.purge();
        //           // }

        //           originalEmit.apply(this, args);//(event, filePath, mtime, explanation);
        //         }, 1200); // Adjust quiet window as needed (e.g. 1000ms - 1500ms)

        //         // Block immediate event emission for this .NET file
        //         return true;
        //       }
        //     }

        //     // Standard JS / CSS / TS files pass through IMMEDIATELY with zero delay
        //     return originalEmit(event, filePath, mtime, explanation);
        //   };
        // }

        // return watcher;
        const roots = ctx.assetResolver.roots();
        let pendingFiles = new Set<string>();
        // Intercept the final watcher callback that Webpack uses to execute compilation
        const wrappedCallback = (
          err: Error | null,
          fileTimestamps: Map<string, number>,
          dirTimestamps: Map<string, number>,
          changedFiles: Set<string>,
          removedFiles: Set<string>
        ) => {
          if (err) return callback(err, fileTimestamps, dirTimestamps, changedFiles, removedFiles);

          // Check if any of the changed files are in .NET asset roots
          const dotnetFiles = Array.from(changedFiles || []).filter(file =>
            roots.some(root => file.startsWith(root))
          );

          if (dotnetFiles.length === 0) {
            // Normal JS/CSS edits proceed instantly with ZERO delay
            return callback(null, fileTimestamps, dirTimestamps, changedFiles, removedFiles);
          }

          ctx.logger.info(`[unplugin-dotnet-wasm] .NET asset changes detected: ${dotnetFiles.length} files`);

          // Collect pending files across multiple MSBuild write spikes
          dotnetFiles.forEach(f => pendingFiles.add(f));

          if (dotnetTimer) {
            clearTimeout(dotnetTimer);
          }

          dotnetTimer = setTimeout(() => {
            dotnetTimer = null;
            pendingFiles.clear();

            ctx.logger.info('[unplugin-dotnet-wasm] MSBuild writes quieted down. Executing compilation...');

            const inputFs = (compiler as any).inputFileSystem;
            if (inputFs && typeof inputFs.purge === 'function') {
              inputFs.purge();
            }

            // Release compilation to Webpack
            callback(null, fileTimestamps, dirTimestamps, changedFiles, removedFiles);
          }, 3000);
        };

        return origWatch(files, dirs, missing, startTime, options, wrappedCallback, undelayed);
      //};
      };
    //   const origWatch = compiler.watchFileSystem.watch.bind(compiler.watchFileSystem);  
    //   compiler.watchFileSystem.watch = (files, dirs, missing, startTime, options, callback, undelayed) => {
    //     // Wrap Webpack's trigger mechanism
    //     const debouncedUndelayed = (fileName: string, changeTime: number) => {
    //       const roots = ctx.assetResolver.roots();
    //       const isDotnetEvent = roots.some(root => fileName.startsWith(root));

    //       if (!isDotnetEvent) {
    //         // Proceed immediately for standard JS/CSS changes
    //         console.log(`[unplugin-dotnet-wasm] Non-.NET file change detected on: ${fileName}`);
    //         return undelayed(fileName, changeTime);
    //       }

    //       console.log(`[unplugin-dotnet-wasm] .NET file activity detected on: ${fileName}`);

    //       // If MSBuild is still spamming writes, push back the timer
    //       if (timer) {
    //         console.log('HOLDING: Resetting timer, waiting for MSBuild to finish...');
    //         clearTimeout(timer);
    //       } else {
    //         console.log('HOLDING: MSBuild activity started, delaying Webpack compilation...');
    //       }

    //       timer = setTimeout(() => {
    //         timer = null;
    //         console.log('Debounced .NET asset changes stabilized, proceeding with compilation...');
    //         undelayed(fileName, changeTime);
    //       }, 5000); // 2000ms is usually a sweet spot, adjust as needed
    //     };

    //     return origWatch(files, dirs, missing, startTime, options, callback, debouncedUndelayed);
    //   };
    });
  }

  return {
    webpack: (compiler) => {
      applyBuildConfig(compiler.options);
      awaitContextInit(compiler);
      registerDevServerMiddleware(compiler);
      watchContentRoots(compiler);
    },
    rspack: (compiler) => {
      applyBuildConfig(compiler.options);
      awaitContextInit(compiler);
      registerDevServerMiddleware(compiler);
      watchContentRoots(compiler);
    },
    rsbuild: {
      setup(api) {
        api.modifyRspackConfig((config) => {
          applyBuildConfig(config, { prepend: true });
        });
        api.onAfterCreateCompiler(({ compiler }) => {
          const c = compiler as { hooks?: CompilerHooks };
          awaitContextInit(c);
          watchContentRoots(c);
        });
        api.onBeforeStartDevServer(({ server }) => {
          server.middlewares.use((...args: Parameters<typeof ctx.assetMiddleware>) => {
            ctx.assetMiddleware(...args);
          });
        });
      },
    },
  };
}
