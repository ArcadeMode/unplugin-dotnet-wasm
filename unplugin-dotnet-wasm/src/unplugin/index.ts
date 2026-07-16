import { createUnplugin, type UnpluginContextMeta } from 'unplugin';
import { readFile } from 'node:fs/promises';
import { basename, join, parse } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DotnetAssetsOptions } from '../types';
import { ManifestLoader } from '../core/manifest-parsing/loader';
import { buildEndpointLookup } from '../core/asset-resolution/endpoint-lookup';
import { buildVfs, buildEmptyVfs } from '../core/asset-resolution/vfs';
import { createConsoleLogger } from '../core/logger';
import { AssetResolver } from '../core/asset-resolution/asset-resolver';
import { ShimPackageGenerator } from '../core/type-shims/shim-package-generator';
import { SourceFileChangeTracker } from '../core/type-shims/source-file-change-tracker';
import { TsDefinitionEmitter } from '../core/type-shims/ts-definition-emitter';
import { BundlerCompatRewriter, type BundlerFramework } from '../core/bundler-compat-rewriter';
import { isYarnPnp } from '../core/is-yarn-pnp';
import { createAssetMiddleware, type ConnectMiddleware } from '../core/dev-server/asset-middleware';
import { BINARY_EXTENSIONS, BINARY_EXTENSIONS_REGEX, FRAMEWORK_BINARY_REGEX, FRAMEWORK_JS_REGEX, DOTNET_NODE_BUILTINS } from '../core/constants';

export const dotnetStaticAssets = createUnplugin((options: DotnetAssetsOptions, meta: UnpluginContextMeta) => {
  const framework = meta.framework;
  const isRollupFamily = framework === 'rollup' || framework === 'vite' || framework === 'rolldown';
  const isWebpackFamily = framework === 'webpack' || framework === 'rspack' || framework === 'rsbuild';
  const isEsbuildFamily = framework === 'esbuild' || framework === 'bun';

  const logLevel = options.logLevel ?? 'warn';
  const logger = createConsoleLogger(logLevel);
  const rewriter = new BundlerCompatRewriter(framework as BundlerFramework);
  // Tracks source file mtimes across builds (survives the plugin instance lifetime).
  const changeTracker = new SourceFileChangeTracker();

  let assetResolver: AssetResolver | null = null;
  // Default root path of project, bundler families may override.
  let consumerRoot = process.cwd();
  let packageGenerator: ShimPackageGenerator | null = null;
  let isServe = false;
  let assetMiddleware: ConnectMiddleware | null = null;

  const base = {
    name: 'unplugin-dotnet-wasm',
    enforce: 'pre' as const,
    async buildStart(): Promise<void> {
      const loader = new ManifestLoader();
      const { endpointsManifest, runtimeManifest, endpointsManifestPath } = await loader.load(options);
      const endpointLookup = buildEndpointLookup(endpointsManifest);
      const vfs = runtimeManifest
        ? buildVfs(runtimeManifest, { logger })
        : buildEmptyVfs(endpointsManifestPath, { logger });
      assetResolver = new AssetResolver(vfs, endpointLookup);

      if (isYarnPnp()) {
        logger.warn(`Yarn Plug'n'Play detected: skipping editor/tsc type-shim generation. Asset resolution and bundling are unaffected but type info from '${options.projectName}' will most likely not be available.`);
        return;
      }

      const emitter = new TsDefinitionEmitter(consumerRoot, logger);
      packageGenerator = new ShimPackageGenerator(
        consumerRoot,
        assetResolver,
        changeTracker,
        emitter,
        logger
      );
      await packageGenerator.generate();
    },
    resolveId(source: string): string | null {
      if (!assetResolver) return null;
      return assetResolver.resolve(source);
    },
    transform: {
      filter: { id: FRAMEWORK_JS_REGEX },
      handler(code: string): { code: string; map: null } | null {
        const fixed = rewriter.rewrite(code);
        if (fixed == null) return null;
        return { code: fixed, map: null };
      },
    },
  };

  // ── Rollup family (rollup / vite / rolldown) ────────────────────────────
  // Emit binary assets via Rollup's native asset API; the ROLLUP_FILE_URL_*
  // placeholder is rewritten to the final hashed URL at bundle time.
  if (isRollupFamily) {
    return {
      ...base,
      // Vite: capture the resolved consumer root so type-shim packages land in
      // the right node_modules, and detect serve (dev) mode. `configResolved`
      // fires before `buildStart`, so both are set in time. No-op for
      // rollup/rolldown (no dev server / no root concept).
      vite: {
        configResolved(config: { root: string; command: string }): void {
          consumerRoot = config.root;
          isServe = config.command === 'serve';
        },
        configureServer(server: {
          middlewares: { use: (fn: ConnectMiddleware) => void };
        }): void {
          server.middlewares.use((req, res, next) => {
            if (!assetResolver) return next();
            assetMiddleware ??= createAssetMiddleware(assetResolver, logger);
            assetMiddleware(req, res, next);
          });
        },
      },
      load: {
        filter: { id: BINARY_EXTENSIONS_REGEX },
        async handler(id: string): Promise<string> {
          // Dev/serve: return an explicit middleware route so the dotnet runtime
          // fetches our handler (independent of scriptDirectory) instead of
          // falling back to Vite's /@fs/ static handler.
          if (isServe) {
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

  // ── Webpack family (webpack / rspack / rsbuild) ─────────────────────────
  // In build mode: `asset/resource` module rule via the compiler hook handles binaries.
  // In serve mode: unplugin `load` hook returns the middleware route, and
  // setupMiddlewares middleware serves runtime-fetched assets.
  if (isWebpackFamily) {
    isServe = process.env.WEBPACK_SERVE === 'true';

    // Force dotnet's binary assets to emit as static files. Scoped to dotnet SDK
    // files so user .wasm files keep their default bundler handling.
    const webpackBinaryRule = {
      test: FRAMEWORK_BINARY_REGEX,
      type: 'asset/resource',
    };

    // Disable URL-dependency tracking for dotnet _framework JS files. They are loaded
    // at runtime by the bootstrapping code and shouldnt be bundled.
    const webpackJsParserRule = {
      test: FRAMEWORK_JS_REGEX,
      parser: { url: false },
    };

    type WebpackLikeOptions = {
      context?: string;
      resolve?: { fallback?: Record<string, unknown> };
      module?: { rules?: unknown[] };
      devServer?: Record<string, unknown>;
    };

    function externalizeNodeBuiltins(opts: WebpackLikeOptions): void {
      opts.resolve ??= {};
      opts.resolve.fallback ??= {};
      for (const mod of DOTNET_NODE_BUILTINS) {
        if (!(mod in opts.resolve.fallback)) {
          opts.resolve.fallback[mod] = false;
        }
      }
    }

    function registerDevServerMiddleware(compiler: { options: WebpackLikeOptions }): void {
      if (!isServe) return;

      compiler.options.devServer ??= {};
      const devServerConfig = compiler.options.devServer as Record<string, unknown>;
      const existingSetup = devServerConfig.setupMiddlewares as ((middlewares: unknown[], devServer: unknown) => unknown[]) | undefined;

      devServerConfig.setupMiddlewares = (middlewares: unknown[], devServer: unknown): unknown[] => {
        const assetMiddlewareEntry = {
          name: 'unplugin-dotnet-wasm',
          middleware: (req: unknown, res: unknown, next: (err?: unknown) => void): void => {
            if (!assetResolver) {
              next();
              return;
            }
            assetMiddleware ??= createAssetMiddleware(assetResolver, logger);
            (assetMiddleware as ConnectMiddleware)(req as IncomingMessage, res as ServerResponse,
              next as (err?: unknown) => void
            );
          },
        };
        (middlewares as unknown[]).unshift(assetMiddlewareEntry);

        if (existingSetup) {
          return existingSetup(middlewares, devServer);
        }
        return middlewares;
      };
    }

    return {
      ...base,
      webpack(compiler: { options: { context?: string; module?: { rules?: unknown[] } } }) {
        const opts = compiler.options as WebpackLikeOptions;
        if (opts.context) consumerRoot = opts.context;
        opts.module ??= { rules: [] };
        opts.module.rules ??= [];
        opts.module.rules.push(webpackBinaryRule, webpackJsParserRule);
        externalizeNodeBuiltins(opts);
        registerDevServerMiddleware(compiler as { options: WebpackLikeOptions });
      },
      rspack(compiler: { options: { context?: string; module?: { rules?: unknown[] } } }) {
        const opts = compiler.options as WebpackLikeOptions;
        if (opts.context) consumerRoot = opts.context;
        opts.module ??= { rules: [] };
        opts.module.rules ??= [];
        opts.module.rules.push(webpackBinaryRule, webpackJsParserRule);
        externalizeNodeBuiltins(opts);
        registerDevServerMiddleware(compiler as { options: WebpackLikeOptions });
      },
      rsbuild: {
        setup(api: { modifyRspackConfig: (fn: (config: unknown) => void) => void }) {
          api.modifyRspackConfig((config: unknown) => {
            const opts = config as WebpackLikeOptions;
            if (opts.context) consumerRoot = opts.context;
            opts.module ??= { rules: [] };
            opts.module.rules ??= [];
            opts.module.rules.unshift(webpackBinaryRule, webpackJsParserRule);
            externalizeNodeBuiltins(opts);
            registerDevServerMiddleware({ options: opts });
          });
        },
      },
    };
  }

  // ── esbuild family (esbuild / bun) ──────────────────────────────────────
  // Skip unplugin's resolveId bridge on this family — it places the resolved
  // path in a plugin-scoped namespace, bypassing the bundler's native
  // extension-loader mapping (.wasm → file). Register onResolve directly
  // inside the framework hook so files land in the default namespace where
  // esbuild/bun's loaders take over. Both hooks use the object shape
  // { setup(build) {} } in unplugin 3.x (not bare functions).
  if (isEsbuildFamily) {
    const setup = (build: {
      initialOptions: { absWorkingDir?: string; external?: string[]; loader?: Record<string, string> };
      onResolve: (
        opts: { filter: RegExp },
        cb: (args: { path: string }) => { path: string } | null,
      ) => void;
      onLoad: (
        opts: { filter: RegExp },
        cb: (args: { path: string }) => Promise<{ contents: string; loader: 'js' } | null> | null,
      ) => void;
    }) => {
      // Capture the consumer root for type-shim generation (buildStart fires after setup).
      if (build.initialOptions.absWorkingDir) consumerRoot = build.initialOptions.absWorkingDir;
      // Register Node built-ins as external so esbuild doesn't try to bundle them.
      build.initialOptions.external ??= [];
      for (const mod of DOTNET_NODE_BUILTINS) {
        if (!build.initialOptions.external.includes(mod))
          build.initialOptions.external.push(mod);
      }
      // Register 'file' loader for binary extensions unless the user already set one.
      build.initialOptions.loader ??= {};
      for (const binExt of BINARY_EXTENSIONS) {
        if (!build.initialOptions.loader[binExt]) {
          build.initialOptions.loader[binExt] = 'file';
        }
      }
      build.onResolve({ filter: /.*/ }, args => {
        if (!assetResolver) return null;
        const resolved = assetResolver.resolve(args.path);
        return resolved !== null ? { path: resolved } : null;
      });
      build.onLoad({ filter: /\.js$/ }, async args => {
        if (!FRAMEWORK_JS_REGEX.test(args.path)) return null;
        const source = await readFile(args.path, 'utf-8');
        const fixed = rewriter.rewrite(source);
        if (!fixed) return null;
        return { contents: fixed, loader: 'js' as const };
      });
    };
    return {
      name: base.name,
      enforce: base.enforce,
      buildStart: base.buildStart,
      esbuild: { setup },
      bun: { setup },
    };
  }

  // ── Farm ────────────────────────────────────────────────────────────────
  // resolveId is sufficient; Farm marks binary extensions as emittable assets
  // via `compilation.assets.include` in the farm config (user responsibility,
  // not a plugin hook). Example: include: ['wasm', 'dat', 'pdb'].
  //
  // Farm defaults `output.targetEnv` to `'browser-es2017'`, which enables SWC
  // preset-env polyfill injection and requires `core-js` to be installed.
  // The dotnet WASM runtime needs modern JS anyway, so warn users pointing at
  // a non-modern target — usually they want `'browser-esnext'`.
  const FARM_CONTENT_DIR = '__dotnet_content__';
  const farmContentAliases = new Map<string, string>();
  return {
    ...base,
    resolveId(source: string): string | null {
      if (!assetResolver) return null;
      const resolved = assetResolver.resolve(source);
      if (resolved === null) return null;
      if (parse(resolved).root.toLowerCase() !== parse(consumerRoot).root.toLowerCase()) {
        farmContentAliases.set(basename(resolved), resolved);
        return join(consumerRoot, FARM_CONTENT_DIR, basename(resolved));
      }
      return resolved;
    },
    // Gate `load` to our synthetic ids only: Farm's unplugin adapter has no
    // null-guard and would call getContentValue(null) for every other module.
    loadInclude(id: string): boolean {
      return id.includes(FARM_CONTENT_DIR);
    },
    async load(id: string): Promise<string | null> {
      const real = farmContentAliases.get(basename(id));
      return real === undefined ? null : readFile(real, 'utf-8');
    },
    farm: {
      config(userConfig: { root?: string; compilation?: { output?: { targetEnv?: string }; presetEnv?: unknown } }) {
        if (userConfig.root) consumerRoot = userConfig.root;
        const targetEnv = userConfig.compilation?.output?.targetEnv;
        const presetEnv = userConfig.compilation?.presetEnv;
        const polyfillFree = targetEnv === 'browser-esnext' || targetEnv === 'node-next' || presetEnv === false;
        if (!polyfillFree) {
          logger.warn(
            `The configured compilation.output.targetEnv (${targetEnv ?? 'browser-es2017'}) enables preset-env polyfill injection, ` +
            `which requires 'core-js' to be installed. Alternatively set compilation.output.targetEnv: 'browser-esnext' | 'node-next' ` +
            `to skip polyfills.`,
          );
        }
        return {};
      },
    },
  };
});
