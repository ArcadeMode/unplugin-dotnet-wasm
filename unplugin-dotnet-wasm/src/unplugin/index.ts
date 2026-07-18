import { createUnplugin, type UnpluginContextMeta } from 'unplugin';
import type { DotnetAssetsOptions } from '../types';
import type { BundlerFramework } from '../core/bundler-compat-rewriter';
import { FRAMEWORK_JS_REGEX } from '../core/constants';
import { PluginContext } from './context';
import { createRollupFamily } from './families/rollup-family';
import { createWebpackFamily } from './families/webpack-family';
import { createEsbuildFamily } from './families/esbuild-family';
import { createFarmFamily } from './families/farm-family';

export const dotnetStaticAssets = createUnplugin(
  (options: DotnetAssetsOptions, meta: UnpluginContextMeta) => {
    const framework = meta.framework;
    const isRollupFamily =
      framework === 'rollup' || framework === 'vite' || framework === 'rolldown';
    const isWebpackFamily =
      framework === 'webpack' || framework === 'rspack' || framework === 'rsbuild';
    const isEsbuildFamily = framework === 'esbuild' || framework === 'bun';

    const ctx = new PluginContext(options, framework as BundlerFramework);

    const base = {
      name: 'unplugin-dotnet-wasm',
      enforce: 'pre' as const,
      async buildStart(): Promise<void> {
        await ctx.initialize();
      },
      resolveId(source: string): string | null {
        return ctx.assetResolver.resolve(source);
      },
      transform: {
        filter: { id: FRAMEWORK_JS_REGEX },
        handler(code: string): { code: string; map: null } | null {
          // dotnet SDK js files contain some warning-producing statements,
          // we rewrite them to silence the warnings end users cannot resolve anyway.
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
      return {
        name: base.name,
        enforce: base.enforce,
        buildStart: base.buildStart,
        ...createEsbuildFamily(ctx),
      };
    }

    return { ...base, ...createFarmFamily(ctx) };
  },
);
