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

interface EsbuildBuild {
  initialOptions: { absWorkingDir?: string; external?: string[]; loader?: Record<string, string> };
  onResolve: (
    opts: { filter: RegExp; namespace?: string },
    cb: (args: {
      path: string;
      namespace?: string;
      importer?: string;
    }) => { path: string; namespace?: string } | null,
  ) => void;
  onLoad: (
    opts: { filter: RegExp; namespace?: string },
    cb: (args: {
      path: string;
    }) =>
      | Promise<{ contents: string; loader: 'js'; resolveDir?: string } | null>
      | { contents: string; loader: 'js'; resolveDir?: string }
      | null,
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

    // Route binary assets through the import.meta.url proxy so the exported value is a portable
    // URL string (http(s): browser, file: node). Guard on the importer: a proxy module's own
    // inner re-import must pass through untouched (bun reports its namespace as `file`, so we
    // key the guard on the importer path, not the namespace).
    build.onResolve({ filter: /.*/ }, (args) => {
      if (args.importer?.endsWith(PROXY_SUFFIX)) return null;

      const resolved = ctx.assetResolver.resolve(args.path);
      let assetPath: string | null = null;
      if (resolved !== null) {
        if (!BINARY_EXTENSIONS_REGEX.test(resolved)) return { path: resolved };
        assetPath = resolved;
      } else if (BINARY_EXTENSIONS_REGEX.test(args.path) && args.importer) {
        assetPath = resolve(dirname(args.importer), args.path);
      }
      if (assetPath === null) return null;
      return { path: assetPath + PROXY_SUFFIX, namespace: URL_PROXY_NAMESPACE };
    });

    // Emit the proxy module: re-import the real asset by its absolute path (→ built-in file
    // loader → chunk-relative copy) and resolve it against import.meta.url. The inner import is
    // absolute so both bundlers resolve it to a distinct file-namespace module (see PROXY_SUFFIX).
    build.onLoad({ filter: /.*/, namespace: URL_PROXY_NAMESPACE }, (args) => {
      const realPath = args.path.slice(0, -PROXY_SUFFIX.length);
      return {
        contents: buildImportMetaUrlModule(realPath),
        loader: 'js' as const,
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
