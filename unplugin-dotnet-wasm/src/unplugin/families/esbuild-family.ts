import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve, relative } from 'node:path';
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

    // First-encounter resolution (imports inside file-namespace modules).
    build.onResolve({ filter: /.*/ }, (args) => {
      const resolved = ctx.assetResolver.resolve(args.path);
      if (resolved === null) {
        // Asset resolver missed; check if the path itself is a binary extension.
        // If it's a relative path and we have an importer, resolve it to an absolute path.
        if (BINARY_EXTENSIONS_REGEX.test(args.path) && args.importer) {
          const importerDir = dirname(args.importer);
          const absolutePath = resolve(importerDir, args.path);
          // Encode the directory so the proxy handler can resolve relative imports
          return { path: `proxy:${absolutePath}`, namespace: URL_PROXY_NAMESPACE };
        }
        return null;
      }
      // Binary assets → route through the import.meta.url proxy so the exported value is a
      // portable URL string (http(s): in browser, file: in Node) with no consumer shim.
      if (BINARY_EXTENSIONS_REGEX.test(resolved)) {
        // Encode the directory so the proxy handler can resolve relative imports
        return { path: `proxy:${resolved}`, namespace: URL_PROXY_NAMESPACE };
      }
      return { path: resolved };
    });

    // The proxy module's inner re-import → hand the real file to esbuild's built-in `file`
    // loader (default `file` namespace) so it emits the copy and yields a chunk-relative path.
    // This is also the recursion guard: the inner import never re-enters the proxy.
    build.onResolve({ filter: /.*/, namespace: URL_PROXY_NAMESPACE }, (args) => {
      if (args.path.startsWith('proxy:')) {
        // This is the inner import from the proxy module. Extract the asset path and
        // resolve the relative import against it.
        const assetPath = args.path.slice(6); // Remove 'proxy:' prefix
        const assetDir = dirname(assetPath);
        const relativeImport = args.importer ? args.path : '';
        // For relative imports like './dotnet.native.wasm', resolve against the asset dir
        return null; // Let esbuild handle it after we process the outer proxy path
      }
      // Inner re-imports from the proxy (like './dotnet.native.wasm') are resolved
      // relative to the asset directory. Return the path for esbuild's file loader.
      return { path: args.path };
    });

    build.onLoad({ filter: /.*/, namespace: URL_PROXY_NAMESPACE }, (args) => {
      const assetPath = args.path.startsWith('proxy:') ? args.path.slice(6) : args.path;
      return {
        contents: buildImportMetaUrlModule(basename(assetPath)),
        loader: 'js' as const,
        resolveDir: dirname(assetPath),
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
