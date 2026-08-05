import { createUnplugin, type UnpluginContextMeta } from 'unplugin';
import type { DotnetWasmOptions } from '../types';
import type { BundlerFramework } from '../core/bundler-compat-rewriter';
import { FRAMEWORK_JS_REGEX } from '../core/constants';
import { PluginContext } from './context';
import { createRollupFamily } from './bundlers/rollup-family';
import { createWebpackFamily } from './bundlers/webpack-family';
import { createEsbuildFamily } from './bundlers/esbuild-family';
import { createFarm } from './bundlers/farm';

export const dotnetWasmUnplugin = createUnplugin(
  (options: DotnetWasmOptions, meta: UnpluginContextMeta) => {
    const framework = meta.framework as BundlerFramework;
    const ctx = new PluginContext(options, framework);

    const base = {
      name: 'unplugin-dotnet-wasm',
      enforce: 'pre' as const,
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

    if (framework === 'rollup' || framework === 'vite' || framework === 'rolldown') {
      return { ...base, ...createRollupFamily(ctx) };
    }

    if (framework === 'webpack' || framework === 'rspack' || framework === 'rsbuild') {
      return { ...base, ...createWebpackFamily(ctx) };
    }

    if (framework === 'esbuild' || framework === 'bun') {
      return {
        name: base.name,
        enforce: base.enforce,
        ...createEsbuildFamily(ctx),
      };
    }

    return { ...base, ...createFarm(ctx) };
  },
);
