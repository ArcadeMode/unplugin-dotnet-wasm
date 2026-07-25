import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  BINARY_EXTENSIONS,
  BINARY_EXTENSIONS_REGEX,
  FRAMEWORK_JS_REGEX,
  DOTNET_NODE_BUILTINS,
} from '../../core/constants';
import { buildImportMetaUrlModule } from '../../core/asset-resolution/asset-url-module';
import type { PluginContext } from '../context';

const URL_PROXY_NAMESPACE = 'dotnet-url-proxy';
// Appended to the proxy module's path so it never shares a module key with the real asset.
// esbuild keys modules by namespace+path, but bun keys by path alone — without a distinct path
// the proxy's inner re-import collapses back into the proxy itself (self-referential undefined).
const PROXY_SUFFIX = '.__dotnet_url_proxy__';

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
      if (!build.initialOptions.external.includes(mod)) build.initialOptions.external.push(mod);
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
      let assetPath: string | null = null;
      if (resolved !== null) {
        if (!BINARY_EXTENSIONS_REGEX.test(resolved)) {
          return { path: resolved };
        }
        assetPath = resolved;
      } else if (BINARY_EXTENSIONS_REGEX.test(args.path) && args.importer) {
        assetPath = resolve(dirname(args.importer), args.path);
      }

      if (assetPath === null) {
        return null;
      }
      
      return { 
        path: assetPath + PROXY_SUFFIX, 
        namespace: URL_PROXY_NAMESPACE 
      };
    });

    // Emit the proxy module: re-import the real asset by its absolute path 
    build.onLoad({ filter: /.*/, namespace: URL_PROXY_NAMESPACE }, (args) => {
      const realPath = args.path.slice(0, -PROXY_SUFFIX.length);
      return {
        contents: buildImportMetaUrlModule(realPath),
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
