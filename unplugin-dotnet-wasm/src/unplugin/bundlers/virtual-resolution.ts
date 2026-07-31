import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import {
  BINARY_EXTENSIONS_REGEX,
  JS_MODULE_REGEX,
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

  // dotnet.js contains all imports so we just resolve js files and binary files to virtual ids
  // (not to mess with e.g. ts/tsx/css/json/... files that need to be transformed by the bundler).
  if (JS_MODULE_REGEX.test(physical)) return VIRTUAL_ROUTE_PREFIX + canonical;
  if (BINARY_EXTENSIONS_REGEX.test(physical)) {
    return opts.binaryAsVirtual ? VIRTUAL_ROUTE_PREFIX + canonical : physical;
  }
  return physical;
}

/**
 * Get module id from virtual route that has passed through the bundler (and was manipulated along the way).
 */
function getModuleFromVirtualRoute(virtualRoute: string | undefined): string | null {
  if (!virtualRoute) return null;
  if (virtualRoute.startsWith(VIRTUAL_ROUTE_PREFIX)) {
    return virtualRoute.slice(VIRTUAL_ROUTE_PREFIX.length);
  }

  // the NUL byte is gone in farm (replaced by a literal `\0`). Search without it.
  const virtualRouteTail = VIRTUAL_ROUTE_PREFIX.slice(1);
  if (!virtualRoute.includes(virtualRouteTail)) {
    return null;
  }

  let decoded = virtualRoute;
  try {
    decoded = decodeURIComponent(virtualRoute);
  } catch {
    // farm ids aren't percent-encoded;
  }

  const markerIdx = decoded.indexOf(virtualRouteTail);
  if (markerIdx === -1) return null;
  return toPosixPath(decoded.slice(markerIdx + virtualRouteTail.length));
}

export async function getVirtualizedModuleContent(
  ctx: PluginContext,
  route: string,
): Promise<{ code: string; path: string } | null> {
  try {
    return await _getVirtualizedModuleContent(ctx, route);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    // Missing file _can_ mean that the manifest was updated (e.g. new fingerprints), reinit and try again.
    ctx.logger.debug(`[serve] load: ENOENT for route "${route}", reinitializing and retrying`);
    await ctx.reinitialize();
    return await _getVirtualizedModuleContent(ctx, route);
  }
}

async function _getVirtualizedModuleContent(
  ctx: PluginContext,
  route: string,
): Promise<{ code: string; path: string } | null> {
  const physical = ctx.assetResolver.resolve(route);
  if (physical === null) {
    ctx.logger.debug(`[serve] load: route "${route}" resolved to null (no physical file)`);
    return null;
  }

  if (BINARY_EXTENSIONS_REGEX.test(physical)) {
    return { code: buildReexportAssetModule(physical), path: physical };
  }

  const code = await readFile(physical, 'utf8');
  return { code: ctx.rewriter.rewrite(code) ?? code, path: physical };
}
