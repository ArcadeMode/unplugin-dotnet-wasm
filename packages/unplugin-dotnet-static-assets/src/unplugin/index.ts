import { createUnplugin } from 'unplugin';
import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative } from 'node:path';
import type { DotnetAssetsOptions } from '../types.js';
import { discoverManifests } from '../core/discover.js';
import { parseRuntimeManifest } from '../core/manifest-runtime.js';
import { parseEndpointsManifest } from '../core/manifest-endpoints.js';
import { buildEndpointLookup } from '../core/endpoint-lookup.js';
import { buildVfs, buildEmptyVfs } from '../core/vfs.js';
import { createConsoleLogger } from '../core/logger.js';
import { AssetResolver } from '../core/asset-resolver.js';

const BINARY_EXTENSIONS = new Set(['.wasm', '.dat', '.pdb']);

// Node.js built-ins referenced inside ENVIRONMENT_IS_NODE guards in dotnet.native.js.
// They are never executed in browser builds, but bundlers that don't auto-externalize
// Node built-ins will fail trying to resolve them at build time.
const DOTNET_NODE_BUILTINS = ['module', 'process', 'fs', 'path', 'url', 'worker_threads'] as const;

type WebpackLikeOptions = {
  resolve?: { fallback?: Record<string, unknown> };
  module?: { rules?: unknown[] };
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

export const dotnetStaticAssets = createUnplugin((options: DotnetAssetsOptions, meta) => {
  const framework = meta.framework;
  const isRollupFamily =
    framework === 'rollup' || framework === 'vite' || framework === 'rolldown';
  const isWebpackFamily =
    framework === 'webpack' || framework === 'rspack' || framework === 'rsbuild';
  const isEsbuildFamily = framework === 'esbuild' || framework === 'bun';

  let assetResolver: AssetResolver | null = null;

  // Absolute path to the project's wwwroot directory — set in buildStart and
  // used by the webpack-family module rule's include predicate to claim only
  // binary files under our own content root.  All binary assets from dotnet.js
  // (imported via relative paths like './Library.wasm') share this root, so
  // an extension-plus-root check is correct even when resolveId isn't called
  // for those transitive imports.
  let contentWwwrootDir: string | null = null;

  async function buildStart() {
    const { runtimeManifestPath, endpointsManifestPath } = discoverManifests(options);
    contentWwwrootDir = join(dirname(endpointsManifestPath), 'wwwroot');
    const logLevel = options.logLevel ?? 'warn';
    const logger = createConsoleLogger(logLevel);
    const [endpointsRaw, runtimeRaw] = await Promise.all([
      readFile(endpointsManifestPath),
      runtimeManifestPath ? readFile(runtimeManifestPath) : Promise.resolve(null),
    ]);
    const endpointLookup = buildEndpointLookup(parseEndpointsManifest(endpointsRaw));
    const vfs = runtimeRaw
      ? buildVfs(parseRuntimeManifest(runtimeRaw), { logger })
      : buildEmptyVfs(endpointsManifestPath, { logger });
    assetResolver = new AssetResolver(vfs, endpointLookup);
  }

  function resolveId(source: string): string | null {
    if (!assetResolver) return null;
    return assetResolver.resolve(source);
  }

  // Webpack/rspack module rule: treats files we own as static assets.
  // Scoped by the `include` predicate so it only claims binary files under
  // our project's wwwroot directory.  This covers both files our resolveId
  // returned AND files imported transitively from dotnet.js via relative
  // paths (e.g. './Library.wasm') which bypass our resolveId hook entirely.
  // User .wasm/.dat/.pdb files outside the project content root keep their
  // default bundler handling (e.g. experiments.asyncWebAssembly on rsbuild).
  const webpackBinaryRule = {
    test: /\.(wasm|dat|pdb)$/,
    include: (resourcePath: string) => {
      if (!contentWwwrootDir) return false;
      const rel = relative(contentWwwrootDir, resourcePath);
      return rel !== '' && !rel.startsWith('..') && !rel.startsWith('/');
    },
    type: 'asset/resource',
  };

  // Webpack/rspack JS rule: disable URL-dependency tracking (new URL('./x', import.meta.url))
  // for dotnet's _framework JS files. webpack 5 treats those new URL() calls as asset
  // dependencies and tries to resolve the path as a file, but dotnet uses them as
  // Node.js URL objects, not as bundler import paths.
  const webpackJsParserRule = {
    test: /\.js$/,
    include: (resourcePath: string) => {
      if (!contentWwwrootDir) return false;
      const rel = relative(contentWwwrootDir, resourcePath);
      return rel !== '' && !rel.startsWith('..') && !rel.startsWith('/');
    },
    parser: { url: false },
  };

  const base = {
    name: 'unplugin-dotnet-static-assets',
    enforce: 'pre' as const,
    buildStart,
    resolveId,
  };

  // ── Rollup family (rollup / vite / rolldown) ────────────────────────────
  // Emit binary assets via Rollup's native asset API; the ROLLUP_FILE_URL_*
  // placeholder is rewritten to the final hashed URL at bundle time.
  if (isRollupFamily) {
    return {
      ...base,
      async load(id: string) {
        const ext = extname(id);
        if (!BINARY_EXTENSIONS.has(ext)) return null;
        const source = await readFile(id);
        const refId = this.emitFile({ type: 'asset', name: basename(id), source });
        return `export default import.meta.ROLLUP_FILE_URL_${refId};`;
      },
    };
  }

  // ── Webpack family (webpack / rspack / rsbuild) ─────────────────────────
  // Omit `load` — unplugin's webpack load-loader is not `raw: true`, so
  // binary bytes would be UTF-8 round-tripped and corrupted. Instead, inject
  // an `asset/resource` module rule via the compiler hook; it fires because
  // our resolveId returns the real absolute path for each owned file.
  // rsbuild has a built-in .wasm rule that runs ahead of appended user rules,
  // so we unshift (not push) via the rsbuild hook to take priority for our
  // files while leaving user-owned .wasm imports on experiments.asyncWebAssembly.
  if (isWebpackFamily) {
    return {
      ...base,
      webpack(compiler: { options: { module?: { rules?: unknown[] } } }) {
        compiler.options.module ??= { rules: [] };
        compiler.options.module.rules ??= [];
        compiler.options.module.rules.push(webpackBinaryRule, webpackJsParserRule);
        externalizeNodeBuiltins(compiler.options as WebpackLikeOptions);
      },
      rspack(compiler: { options: { module?: { rules?: unknown[] } } }) {
        compiler.options.module ??= { rules: [] };
        compiler.options.module.rules ??= [];
        compiler.options.module.rules.push(webpackBinaryRule, webpackJsParserRule);
        externalizeNodeBuiltins(compiler.options as WebpackLikeOptions);
      },
      rsbuild: {
        setup(api: { modifyRspackConfig: (fn: (config: { module?: { rules?: unknown[] } }) => void) => void }) {
          api.modifyRspackConfig(config => {
            config.module ??= { rules: [] };
            config.module.rules ??= [];
            config.module.rules.unshift(webpackBinaryRule, webpackJsParserRule);
            externalizeNodeBuiltins(config as WebpackLikeOptions);
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
      initialOptions: { external?: string[]; loader?: Record<string, string> };
      onResolve: (
        opts: { filter: RegExp },
        cb: (args: { path: string }) => { path: string } | null,
      ) => void;
    }) => {
      const ext = (build.initialOptions.external ??= []);
      for (const mod of DOTNET_NODE_BUILTINS) {
        if (!ext.includes(mod)) ext.push(mod);
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
    };
    return {
      name: 'unplugin-dotnet-static-assets',
      enforce: 'pre' as const,
      buildStart,
      esbuild: { setup },
      bun: { setup },
    };
  }

  // ── Farm ────────────────────────────────────────────────────────────────
  // resolveId is sufficient; Farm marks binary extensions as emittable assets
  // via `compilation.assets.include` in the farm config (user responsibility,
  // not a plugin hook). Example: include: ['wasm', 'dat', 'pdb'].
  return base;
});
