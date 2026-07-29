import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import {
  FRAMEWORK_BINARY_REGEX,
  FRAMEWORK_JS_REGEX,
  VIRTUAL_ROUTE_PREFIX,
} from '../../core/constants';
import { collapseDotSegments, toPosixPath } from '../../core/path-utils';
import { buildReexportAssetModule } from '../../core/asset-resolution/asset-url-module';
import { discoverManifests } from '../../core/manifest-parsing/discover';
import type { PluginContext } from '../context';

export type LoadHandlerContext = {
  /**
   * register watch dependencies for a module (watched file change invalides the module)
   */
  addWatchFile(id: string): void;
};

export function getManifestWatchPaths(ctx: PluginContext): string[] {
  const { endpointsManifestPath, runtimeManifestPath } = discoverManifests(ctx.options);
  return [endpointsManifestPath, runtimeManifestPath].filter((p): p is string => p !== null);
}

/**
 * Serve-only. Gives a framework specifier a fingerprint-independent identity, so
 * fingerprint changes dont break the bundler's module graph.
 */
export function resolveVirtualId(
  ctx: PluginContext,
  source: string,
  importer: string | undefined,
  opts: { binaryAsVirtual: boolean },
): string | null {
  // Absolute specifiers and already-virtual ids are resolved; let the bundler handle them.
  if (isAbsolute(source) || source.startsWith(VIRTUAL_ROUTE_PREFIX)) return null;

  let route = source;
  if (source.startsWith('./') || source.startsWith('../')) {
    // Relative specifier, need to resolve against the importer's route.
    const importerRoute = getModuleFromVirtualRoute(importer);
    if (importerRoute !== null) {
      const importerDir = importerRoute.slice(0, importerRoute.lastIndexOf('/'));
      route = collapseDotSegments(toPosixPath(`${importerDir}/${source}`));
    }
  }

  const canonical = ctx.assetResolver.canonicalRoute(route);
  if (canonical === null) return null;
  const physical = ctx.assetResolver.resolve(canonical);
  if (physical === null) return null;

  if (FRAMEWORK_JS_REGEX.test(physical)) return VIRTUAL_ROUTE_PREFIX + canonical;
  if (FRAMEWORK_BINARY_REGEX.test(physical)) {
    return opts.binaryAsVirtual ? VIRTUAL_ROUTE_PREFIX + canonical : physical;
  }
  return physical; // TODO: non-framework stuff will still be fingerprinted, should probably virtualize?
}

function getModuleFromVirtualRoute(importer: string | undefined): string | null {
  if (!importer) return null;
  let decoded = importer;
  if (!importer.startsWith(VIRTUAL_ROUTE_PREFIX)) {
    if (!importer.includes('dotnet-wasm')) return null;
    try {
      decoded = decodeURIComponent(importer);
    } catch {
      return null;
    }
  }
  const idx = decoded.indexOf(VIRTUAL_ROUTE_PREFIX);
  if (idx === -1) return null;
  return decoded.slice(idx + VIRTUAL_ROUTE_PREFIX.length);
}

export async function getVirtualizedModuleContent(
  ctx: PluginContext,
  loadCtx: LoadHandlerContext,
  route: string,
  extraWatchPaths: readonly string[],
): Promise<string | null> {
  try {
    return await _getVirtualizedModuleContent(ctx, loadCtx, route, extraWatchPaths);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    // Missing file _can_ mean that the manifest was updated (e.g. new fingerprints), reinit and try again.
    ctx.logger.debug(`[serve] load: ENOENT for route "${route}", reinitializing and retrying`);
    await ctx.reinitialize();
    return await _getVirtualizedModuleContent(ctx, loadCtx, route, extraWatchPaths);
  }
}

async function _getVirtualizedModuleContent(
  ctx: PluginContext,
  loadCtx: LoadHandlerContext,
  route: string,
  extraWatchPaths: readonly string[],
): Promise<string | null> {
  const physical = ctx.assetResolver.resolve(route);
  if (physical === null) {
    ctx.logger.debug(`[serve] load: route "${route}" resolved to null (no physical file)`);
    return null;
  }

  // addWatchFile re-invokes `load` when the file changes (invalidates the virtual route).
  loadCtx.addWatchFile(physical);
  // Also depend on the manifests so a manifest change forces this module to rebuild.
  for (const manifestPath of extraWatchPaths) loadCtx.addWatchFile(manifestPath);

  if (FRAMEWORK_BINARY_REGEX.test(physical)) return buildReexportAssetModule(physical);

  const code = await readFile(physical, 'utf8');
  return ctx.rewriter.rewrite(code) ?? code;
}
