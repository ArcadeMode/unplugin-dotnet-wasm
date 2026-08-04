import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { BINARY_EXTENSIONS_REGEX, JS_MODULE_REGEX } from '../constants';
import { collapseDotSegments, toPosixPath } from '../path-utils';
import type { Logger } from '../logger';
import type { BundlerCompatRewriter, BundlerFramework } from '../bundler-compat-rewriter';
import { buildNewUrlAssetProxyModule, buildReexportAssetModule } from './asset-url-module';
import type { AssetResolver } from './asset-resolver';
import { isVirtualId, routeFromVirtualId, toVirtualId } from './virtual-id';

/** How binary assets are represented at resolve/load time for a given bundler. */
export type BinaryAs = 'physical' | 'virtualReexport' | 'virtualUrlProxy';

function binaryAsFor(framework: BundlerFramework): BinaryAs {
  if (framework === 'farm') return 'virtualUrlProxy';
  if (framework === 'webpack' || framework === 'rspack' || framework === 'rsbuild') {
    return 'virtualReexport';
  }
  return 'physical';
}

export interface VirtualModuleResolverDeps {
  assetResolver: AssetResolver;
  rewriter: BundlerCompatRewriter;
  logger: Logger;
  framework: BundlerFramework;
  /** Rebuilds asset resolution after a manifest change; resolves to the fresh resolver for retry. */
  reinitialize: () => Promise<AssetResolver>;
}

/**
 * Resolves and loads .NET WASM assets as virtual modules. Bundlers delegate
 * their `resolveId`/`load` virtual-route handling here.
 */
export class VirtualModuleResolver {
  readonly binaryAs: BinaryAs;
  readonly #assetResolver: AssetResolver;
  readonly #rewriter: BundlerCompatRewriter;
  readonly #logger: Logger;
  readonly #reinitialize: () => Promise<AssetResolver>;

  constructor(deps: VirtualModuleResolverDeps) {
    this.#assetResolver = deps.assetResolver;
    this.#rewriter = deps.rewriter;
    this.#logger = deps.logger;
    this.#reinitialize = deps.reinitialize;
    this.binaryAs = binaryAsFor(deps.framework);
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

    const canonical = this.#assetResolver.canonicalRoute(route);
    if (canonical === null) return null;
    const physical = this.#assetResolver.resolve(canonical);
    if (physical === null) return null;

    if (JS_MODULE_REGEX.test(physical)) return toVirtualId(canonical);
    if (BINARY_EXTENSIONS_REGEX.test(physical)) {
      return this.binaryAs === 'physical' ? physical : toVirtualId(canonical);
    }
    return physical;
  }

  async loadContent(route: string): Promise<{ code: string; path: string } | null> {
    try {
      return await this.#load(this.#assetResolver, route);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      this.#logger.debug(`[serve] load: ENOENT for route "${route}", reinitializing and retrying`);
      const resolver = await this.#reinitialize();
      return this.#load(resolver, route);
    }
  }

  async #load(
    resolver: AssetResolver,
    route: string,
  ): Promise<{ code: string; path: string } | null> {
    const physical = resolver.resolve(route);
    if (physical === null) {
      this.#logger.debug(`[serve] load: route "${route}" resolved to null (no physical file)`);
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
    return { code: this.#rewriter.rewrite(code) ?? code, path: physical };
  }
}
