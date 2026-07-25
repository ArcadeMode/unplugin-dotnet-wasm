import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  BINARY_EXTENSIONS,
  FRAMEWORK_JS_REGEX,
  DOTNET_NODE_BUILTINS,
  PROXY_SUFFIX,
  URL_PROXY_NAMESPACE,
} from '../../core/constants';
import { buildImportProxyModule } from '../../core/asset-resolution/asset-url-module';
import type { PluginContext } from '../context';

type EsbuildHandlerOpts = { filter: RegExp; namespace?: string };
type EsbuildOnResolveCallbackArgs = { path: string; namespace?: string; importer?: string };
type EsbuildOnResolveCallbackResult = { path: string; namespace?: string } | null;
type EsbuildOnLoadCallbackResult = { contents: string; loader: 'js'; resolveDir?: string } | null;

interface EsbuildBuild {
  initialOptions: { absWorkingDir?: string; external?: string[]; loader?: Record<string, string> };
  onResolve: (
    opts: EsbuildHandlerOpts,
    cb: (args: EsbuildOnResolveCallbackArgs) => EsbuildOnResolveCallbackResult,
  ) => void;
  onLoad: (
    opts: EsbuildHandlerOpts,
    cb: (args: { path: string; }) => Promise<EsbuildOnLoadCallbackResult> | EsbuildOnLoadCallbackResult,
  ) => void;
}

export interface EsbuildFamilyHooks {
  esbuild: { setup: (build: EsbuildBuild) => void };
  bun: { setup: (build: EsbuildBuild) => void };
}

export function createEsbuildFamily(ctx: PluginContext): EsbuildFamilyHooks {
  const setup = (build: EsbuildBuild) => {
    if (build.initialOptions.absWorkingDir) {
      ctx.setConsumerRoot(build.initialOptions.absWorkingDir);
    }

    build.initialOptions.external ??= [];
    for (const mod of DOTNET_NODE_BUILTINS) {
      // node builtins must be external to build, add whichever the user doesnt have in config
      if (!build.initialOptions.external.includes(mod)) {
        build.initialOptions.external.push(mod);
      }
    }

    build.initialOptions.loader ??= {};
    for (const binExt of BINARY_EXTENSIONS) {
      if (!build.initialOptions.loader[binExt]) {
        build.initialOptions.loader[binExt] = 'file';
      }
    }

    // Resolve binary assets through proxy modules that re-import the real asset by its absolute path.
    build.onResolve({ filter: /.*/ }, (args) => {
      if (args.importer?.endsWith(PROXY_SUFFIX)) {
        return null; // guard against proxy recursion.
      }

      const resolved = ctx.assetResolver.resolve(args.path);
      const assetPath = ctx.assetResolver.resolvePath(resolved, args.path, args.importer);

      if (assetPath !== null) {
        return { 
          path: assetPath + PROXY_SUFFIX, 
          namespace: URL_PROXY_NAMESPACE 
        };
      }
      
      if (resolved === null) {
        return null;
      }
      
      return { path: resolved };
    });

    // Emit the proxy module: re-import the real asset by its absolute path 
    build.onLoad({ filter: /.*/, namespace: URL_PROXY_NAMESPACE }, (args) => {
      const realPath = args.path.slice(0, -PROXY_SUFFIX.length);
      return {
        contents: buildImportProxyModule(realPath),
        loader: 'js' as const,
        resolveDir: dirname(realPath),
      };
    });

    build.onLoad({ filter: /\.js$/ }, async (args) => {
      if (!FRAMEWORK_JS_REGEX.test(args.path)) return null;
      // dotnet SDK js files contain some warning-producing statements,
      // we rewrite them to silence the warnings end users cannot resolve anyway.
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
