import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import {
  BINARY_EXTENSIONS,
  BINARY_EXTENSIONS_REGEX,
  FRAMEWORK_JS_REGEX,
  DOTNET_NODE_BUILTINS,
} from '../../core/constants';
import { buildImportMetaUrlModule } from '../../core/asset-resolution/asset-url-module';
import type { PluginContext } from '../context';

const URL_PROXY_NAMESPACE = 'dotnet-url-proxy';

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
    // URL string (http(s): browser, file: node). Guard: skip a proxy module's own re-import.
    build.onResolve({ filter: /.*/ }, (args) => {
      if (args.namespace === URL_PROXY_NAMESPACE) return null;

      const resolved = ctx.assetResolver.resolve(args.path);
      let assetPath: string | null = null;
      if (resolved !== null) {
        if (!BINARY_EXTENSIONS_REGEX.test(resolved)) return { path: resolved };
        assetPath = resolved;
      } else if (BINARY_EXTENSIONS_REGEX.test(args.path) && args.importer) {
        assetPath = resolve(dirname(args.importer), args.path);
      }
      if (assetPath === null) return null;
      return { path: assetPath, namespace: URL_PROXY_NAMESPACE };
    });

    // Proxy's inner re-import → resolve into the `file` namespace so the built-in file loader
    // emits a distinct copy. Without the explicit namespace it collapses into the proxy itself.
    build.onResolve({ filter: /.*/, namespace: URL_PROXY_NAMESPACE }, (args) => {
      const realPath = resolve(dirname(args.importer ?? ''), args.path);
      return { path: realPath, namespace: 'file' };
    });

    build.onLoad({ filter: /.*/, namespace: URL_PROXY_NAMESPACE }, (args) => {
      return {
        contents: buildImportMetaUrlModule('./' + basename(args.path)),
        loader: 'js' as const,
        resolveDir: dirname(args.path),
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
