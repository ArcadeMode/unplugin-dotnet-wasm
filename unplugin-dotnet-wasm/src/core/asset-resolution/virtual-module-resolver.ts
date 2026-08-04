import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { BINARY_EXTENSIONS_REGEX, JS_MODULE_REGEX } from '../constants';
import { collapseDotSegments, toPosixPath } from '../path-utils';
import { discoverManifests } from '../manifest-parsing/discover';
import type { Logger } from '../logger';
import type { DotnetWasmOptions } from '../../types';
import { buildNewUrlAssetProxyModule, buildReexportAssetModule } from './asset-url-module';
import type { AssetResolver } from './asset-resolver';
import { isVirtualId, routeFromVirtualId, toVirtualId } from './virtual-id';

/** How binary assets are represented at resolve/load time for a given bundler. */
export type BinaryAs = 'physical' | 'virtualReexport' | 'virtualUrlProxy';

export interface VirtualModuleResolverDeps {
  /**
   * Reads the *current* asset resolver. The resolver is swapped out on every
   * reinitialize, so this must be read fresh on each call rather than captured.
   */
  getAssetResolver(): AssetResolver;
  /** Rewrites framework JS for bundler compat; returns null when unchanged. */
  rewrite(code: string): string | null;
  /** Rebuilds asset resolution after a manifest change (ENOENT self-heal). */
  reinitialize(): Promise<void>;
  logger: Logger;
  options: DotnetWasmOptions;
  binaryAs: BinaryAs;
}

/**
 * Resolves and loads .NET WASM assets as virtual modules. Bundlers delegate
 * their `resolveId`/`load` virtual-route handling here.
 */
export class VirtualModuleResolver {
  readonly binaryAs: BinaryAs;
  readonly manifestWatchPaths: string[];
  readonly #deps: VirtualModuleResolverDeps;

  constructor(deps: VirtualModuleResolverDeps) {
    this.#deps = deps;
    this.binaryAs = deps.binaryAs;
    const { endpointsManifestPath, runtimeManifestPath } = discoverManifests(deps.options);
    this.manifestWatchPaths = [endpointsManifestPath, runtimeManifestPath].filter(
      (p): p is string => p !== null,
    );
  }

  resolveId(source: string, importer?: string): string | null {
    if (isAbsolute(source) || isVirtualId(source)) return null;

    let route = source;
    if (source.startsWith('./') || source.startsWith('../')) {
      const importerRoute = routeFromVirtualId(importer);
      if (importerRoute !== null) {
        const importerDir = importerRoute.slice(0, importerRoute.lastIndexOf('/'));
        route = collapseDotSegments(toPosixPath(`${importerDir}/${source}`));
      }
    }

    const resolver = this.#deps.getAssetResolver();
    const canonical = resolver.canonicalRoute(route);
    if (canonical === null) return null;
    const physical = resolver.resolve(canonical);
    if (physical === null) return null;

    if (JS_MODULE_REGEX.test(physical)) return toVirtualId(canonical);
    if (BINARY_EXTENSIONS_REGEX.test(physical)) {
      return this.binaryAs === 'physical' ? physical : toVirtualId(canonical);
    }
    return physical;
  }

  async loadContent(route: string): Promise<{ code: string; path: string } | null> {
    try {
      return await this.#load(route);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      this.#deps.logger.debug(
        `[serve] load: ENOENT for route "${route}", reinitializing and retrying`,
      );
      await this.#deps.reinitialize();
      return await this.#load(route);
    }
  }

  async #load(route: string): Promise<{ code: string; path: string } | null> {
    const physical = this.#deps.getAssetResolver().resolve(route);
    if (physical === null) {
      this.#deps.logger.debug(`[serve] load: route "${route}" resolved to null (no physical file)`);
      return null;
    }

    if (BINARY_EXTENSIONS_REGEX.test(physical)) {
      const code =
        this.binaryAs === 'virtualUrlProxy'
          ? buildNewUrlAssetProxyModule(physical)
          : buildReexportAssetModule(physical);
      return { code, path: physical };
    }

    const code = await readFile(physical, 'utf8');
    return { code: this.#deps.rewrite(code) ?? code, path: physical };
  }
}
