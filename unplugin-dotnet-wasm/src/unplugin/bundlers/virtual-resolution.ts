import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import {
  BINARY_EXTENSIONS_REGEX,
  JS_MODULE_REGEX,
  VIRTUAL_ROUTE_PREFIX,
} from '../../core/constants';
import { collapseDotSegments, toPosixPath } from '../../core/path-utils';
import {
  buildNewUrlAssetProxyModule,
  buildReexportAssetModule,
} from '../../core/asset-resolution/asset-url-module';
import { discoverManifests } from '../../core/manifest-parsing/discover';
import type { PluginContext } from '../context';

export type LoadHandlerContext = {
  addWatchFile(id: string): void;
};

/** `physical` | `virtualReexport` (webpack) | `virtualUrlProxy` (farm). */
export type BinaryAs = 'physical' | 'virtualReexport' | 'virtualUrlProxy';

export function getManifestWatchPaths(ctx: PluginContext): string[] {
  const { endpointsManifestPath, runtimeManifestPath } = discoverManifests(ctx.options);
  return [endpointsManifestPath, runtimeManifestPath].filter((p): p is string => p !== null);
}

export function resolveVirtualId(
  ctx: PluginContext,
  source: string,
  importer: string | undefined,
  opts: { binaryAs: BinaryAs },
): string | null {
  if (isAbsolute(source) || source.startsWith(VIRTUAL_ROUTE_PREFIX)) return null;

  let route = source;
  if (source.startsWith('./') || source.startsWith('../')) {
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

  if (JS_MODULE_REGEX.test(physical)) return VIRTUAL_ROUTE_PREFIX + canonical;
  if (BINARY_EXTENSIONS_REGEX.test(physical)) {
    return opts.binaryAs === 'physical' ? physical : VIRTUAL_ROUTE_PREFIX + canonical;
  }
  return physical;
}

function getModuleFromVirtualRoute(virtualRoute: string | undefined): string | null {
  if (!virtualRoute) return null;
  if (virtualRoute.startsWith(VIRTUAL_ROUTE_PREFIX)) {
    return virtualRoute.slice(VIRTUAL_ROUTE_PREFIX.length);
  }

  const virtualRouteTail = VIRTUAL_ROUTE_PREFIX.slice(1);
  if (!virtualRoute.includes(virtualRouteTail)) {
    return null;
  }

  let decoded = virtualRoute;
  try {
    decoded = decodeURIComponent(virtualRoute);
  } catch {
    // ignore
  }

  const markerIdx = decoded.indexOf(virtualRouteTail);
  if (markerIdx === -1) return null;
  return toPosixPath(decoded.slice(markerIdx + virtualRouteTail.length));
}

export async function getVirtualizedModuleContent(
  ctx: PluginContext,
  route: string,
  opts: { binaryAs?: BinaryAs } = {},
): Promise<{ code: string; path: string } | null> {
  try {
    return await _getVirtualizedModuleContent(ctx, route, opts);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    ctx.logger.debug(`[serve] load: ENOENT for route "${route}", reinitializing and retrying`);
    await ctx.reinitialize();
    return await _getVirtualizedModuleContent(ctx, route, opts);
  }
}

async function _getVirtualizedModuleContent(
  ctx: PluginContext,
  route: string,
  opts: { binaryAs?: BinaryAs },
): Promise<{ code: string; path: string } | null> {
  const physical = ctx.assetResolver.resolve(route);
  if (physical === null) {
    ctx.logger.debug(`[serve] load: route "${route}" resolved to null (no physical file)`);
    return null;
  }

  if (BINARY_EXTENSIONS_REGEX.test(physical)) {
    const code =
      opts.binaryAs === 'virtualUrlProxy'
        ? buildNewUrlAssetProxyModule(physical)
        : buildReexportAssetModule(physical);
    return { code, path: physical };
  }

  const code = await readFile(physical, 'utf8');
  return { code: ctx.rewriter.rewrite(code) ?? code, path: physical };
}
