import { readFile } from 'node:fs/promises';
import { BINARY_EXTENSIONS, FRAMEWORK_JS_REGEX, DOTNET_NODE_BUILTINS } from '../../core/constants';
import type { PluginContext } from '../context';

interface EsbuildBuild {
  initialOptions: { absWorkingDir?: string; external?: string[]; loader?: Record<string, string> };
  onResolve: (
    opts: { filter: RegExp },
    cb: (args: { path: string }) => { path: string } | null,
  ) => void;
  onLoad: (
    opts: { filter: RegExp },
    cb: (args: { path: string }) => Promise<{ contents: string; loader: 'js' } | null> | null,
  ) => void;
}

export interface EsbuildFamilyHooks {
  esbuild: { setup: (build: EsbuildBuild) => void };
  bun: { setup: (build: EsbuildBuild) => void };
}

export function createEsbuildFamily(ctx: PluginContext): EsbuildFamilyHooks {
  const setup = (build: EsbuildBuild) => {
    // Capture the consumer root for type-shim generation (buildStart fires after setup).
    if (build.initialOptions.absWorkingDir) ctx.consumerRoot = build.initialOptions.absWorkingDir;
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
      if (!ctx.assetResolver) return null;
      const resolved = ctx.assetResolver.resolve(args.path);
      return resolved !== null ? { path: resolved } : null;
    });
    build.onLoad({ filter: /\.js$/ }, async args => {
      if (!FRAMEWORK_JS_REGEX.test(args.path)) return null;
      const source = await readFile(args.path, 'utf-8');
      const fixed = ctx.rewriter.rewrite(source);
      if (!fixed) return null;
      return { contents: fixed, loader: 'js' as const };
    });
  };

  return {
    esbuild: { setup },
    bun: { setup },
  };
}
