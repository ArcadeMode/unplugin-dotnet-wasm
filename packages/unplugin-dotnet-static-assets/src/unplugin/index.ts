import { createUnplugin } from 'unplugin';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { DotnetAssetsOptions } from '../types.js';
import { discoverManifests } from '../core/discover.js';
import { parseRuntimeManifest } from '../core/manifest-runtime.js';
import { parseEndpointsManifest } from '../core/manifest-endpoints.js';
import { buildEndpointLookup } from '../core/endpoint-lookup.js';
import { buildVfs, buildEmptyVfs } from '../core/vfs.js';
import { createConsoleLogger } from '../core/logger.js';
import { AssetResolver } from '../core/asset-resolver.js';

const BINARY_EXTENSIONS = new Set(['.wasm', '.dat', '.pdb']);

export const dotnetStaticAssets = createUnplugin((options: DotnetAssetsOptions, meta) => {
  const framework = meta.framework;
  const isRollupFamily =
    framework === 'rollup' || framework === 'vite' || framework === 'rolldown';
  const isWebpackFamily =
    framework === 'webpack' || framework === 'rspack' || framework === 'rsbuild';
  const isEsbuildFamily = framework === 'esbuild' || framework === 'bun';

  let assetResolver: AssetResolver | null = null;

  // Set of absolute physical paths for binary assets this plugin has resolved.
  // Populated lazily in resolveId; used by the webpack-family module rule's
  // include predicate (which is evaluated per module, after resolveId runs).
  const resolvedBinaryPaths = new Set<string>();

  async function buildStart() {
    const { runtimeManifestPath, endpointsManifestPath } = discoverManifests(options);
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
    const resolved = assetResolver.resolve(source);
    if (resolved !== null) {
      const ext = extname(resolved);
      if (BINARY_EXTENSIONS.has(ext)) resolvedBinaryPaths.add(resolved);
    }
    return resolved;
  }

  // Webpack/rspack module rule: treats files we own as static assets.
  // Scoped by `include` predicate (checks resolvedBinaryPaths) so it only
  // claims the exact files our resolveId returned — user .wasm/.dat/.pdb
  // imports keep their default bundler handling (e.g. experiments.asyncWebAssembly).
  const webpackBinaryRule = {
    test: /\.(wasm|dat|pdb)$/,
    include: (resourcePath: string) => resolvedBinaryPaths.has(resourcePath),
    type: 'asset/resource',
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
        compiler.options.module.rules.push(webpackBinaryRule);
      },
      rspack(compiler: { options: { module?: { rules?: unknown[] } } }) {
        compiler.options.module ??= { rules: [] };
        compiler.options.module.rules ??= [];
        compiler.options.module.rules.push(webpackBinaryRule);
      },
      rsbuild: {
        setup(api: { modifyRspackConfig: (fn: (config: { module?: { rules?: unknown[] } }) => void) => void }) {
          api.modifyRspackConfig(config => {
            config.module ??= { rules: [] };
            config.module.rules ??= [];
            config.module.rules.unshift(webpackBinaryRule);
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
      onResolve: (
        opts: { filter: RegExp },
        cb: (args: { path: string }) => { path: string } | null,
      ) => void;
    }) => {
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
