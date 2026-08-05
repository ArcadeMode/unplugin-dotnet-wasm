import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { BINARY_EXTENSIONS_REGEX, JS_MODULE_REGEX } from '../constants';
import { collapseDotSegments, toPosixPath } from '../path-utils';
import type { Logger } from '../logger';
import type { BundlerCompatRewriter, BundlerFramework } from '../bundler-compat-rewriter';
import { buildNewUrlAssetProxyModule, buildReexportAssetModule } from './asset-url-module';
import type { AssetResolver } from './asset-resolver';
import { isVirtualId, routeFromVirtualId, toVirtualId } from './virtual-id';

type BinaryHandling = 'physical' | 'virtualReexport' | 'virtualUrlProxy';

export class VirtualModuleResolver {
  constructor(
    private readonly assetResolver: AssetResolver,
    private readonly rewriter: BundlerCompatRewriter,
    private readonly logger: Logger,
    private readonly framework: BundlerFramework,
  ) {}

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

    const canonical = this.assetResolver.canonicalRoute(route);
    if (canonical === null) return null;
    const physical = this.assetResolver.resolve(canonical);
    if (physical === null) return null;

    if (JS_MODULE_REGEX.test(physical)) return toVirtualId(canonical);
    if (BINARY_EXTENSIONS_REGEX.test(physical)) {
      return this.getBinaryHandling() === 'physical' ? physical : toVirtualId(canonical);
    }
    return physical;
  }

  async load(
    resolver: AssetResolver,
    route: string,
  ): Promise<{ code: string; path: string } | null> {
    const physical = resolver.resolve(route);
    if (physical === null) {
      this.logger.debug(`[serve] load: route "${route}" resolved to null (no physical file)`);
      return null;
    }

    if (BINARY_EXTENSIONS_REGEX.test(physical)) {
      const code =
        this.getBinaryHandling() === 'virtualUrlProxy'
          ? buildNewUrlAssetProxyModule(physical)
          : buildReexportAssetModule(physical);
      return { code, path: physical };
    }

    const code = await readFile(physical, 'utf8');
    return { code: this.rewriter.rewrite(code) ?? code, path: physical };
  }

  private getBinaryHandling(): BinaryHandling {
    if (this.framework === 'farm') return 'virtualUrlProxy';
    if (
      this.framework === 'webpack' ||
      this.framework === 'rspack' ||
      this.framework === 'rsbuild'
    ) {
      return 'virtualReexport';
    }
    return 'physical';
  }
}
