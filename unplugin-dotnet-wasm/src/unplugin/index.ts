import { createUnplugin, type UnpluginContextMeta } from 'unplugin';
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
import { FRAMEWORK_JS_REGEX } from '../core/constants';
import type { PluginContext } from './context';
import { createRollupFamily } from './families/rollup-family';
import { createWebpackFamily } from './families/webpack-family';
import { createEsbuildFamily } from './families/esbuild-family';
import { createFarmFamily } from './families/farm-family';

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

  const ctx: PluginContext = {
    options,
    logger,
    rewriter,
    assetResolver: null,
    consumerRoot: process.cwd(),
    isServe: false,
    assetMiddleware: null,
  };

  let packageGenerator: ShimPackageGenerator | null = null;

  const base = {
    name: 'unplugin-dotnet-wasm',
    enforce: 'pre' as const,
    async buildStart(): Promise<void> {
      const loader = new ManifestLoader();
      const { endpointsManifest, runtimeManifest, endpointsManifestPath } = await loader.load(ctx.options);
      const endpointLookup = buildEndpointLookup(endpointsManifest);
      const vfs = runtimeManifest
        ? buildVfs(runtimeManifest, { logger: ctx.logger })
        : buildEmptyVfs(endpointsManifestPath, { logger: ctx.logger });
      ctx.assetResolver = new AssetResolver(vfs, endpointLookup);

      if (isYarnPnp()) {
        ctx.logger.warn(`Yarn Plug'n'Play detected: skipping editor/tsc type-shim generation. Asset resolution and bundling are unaffected but type info from '${ctx.options.projectName}' will most likely not be available.`);
        return;
      }

      const emitter = new TsDefinitionEmitter(ctx.consumerRoot, ctx.logger);
      packageGenerator = new ShimPackageGenerator(
        ctx.consumerRoot,
        ctx.assetResolver,
        changeTracker,
        emitter,
        ctx.logger
      );
      await packageGenerator.generate();
    },
    resolveId(source: string): string | null {
      if (!ctx.assetResolver) return null;
      return ctx.assetResolver.resolve(source);
    },
    transform: {
      filter: { id: FRAMEWORK_JS_REGEX },
      handler(code: string): { code: string; map: null } | null {
        const fixed = ctx.rewriter.rewrite(code);
        if (fixed == null) return null;
        return { code: fixed, map: null };
      },
    },
  };

  if (isRollupFamily) {
    return { ...base, ...createRollupFamily(ctx) };
  }

  if (isWebpackFamily) {
    return { ...base, ...createWebpackFamily(ctx) };
  }

  if (isEsbuildFamily) {
    return { name: base.name, enforce: base.enforce, buildStart: base.buildStart, ...createEsbuildFamily(ctx) };
  }

  return { ...base, ...createFarmFamily(ctx) };
});
