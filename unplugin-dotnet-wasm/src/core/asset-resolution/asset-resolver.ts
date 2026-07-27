import type { VirtualFileSystem } from './vfs';
import type { EndpointLookup } from './endpoint-lookup';
import type { ResponseHeader } from '../manifest-parsing/manifest-endpoints';
import { ExtensionProbes } from './extension-probes';
import { normalizePath } from '../path-utils';
import { resolve, dirname } from 'node:path';
import { BINARY_EXTENSIONS_REGEX } from '../constants';

/**
 * Resolves bare/virtual import specifiers against a manifest-backed VFS,
 * with endpoint-route aliasing for fingerprinted asset filenames.
 */
export class AssetResolver {
  constructor(
    private readonly vfs: VirtualFileSystem,
    private readonly endpointLookup: EndpointLookup,
  ) {}

  /**
   * Resolve a bundler `source` specifier to an absolute physical path or `null` if the specifier is unrecognized.
   */
  resolve(source: string): string | null {
    // Collapse relative specifiers (e.g. the bundler-friendly boot config's
    // `./../_content/<pkg>/<pkg>.lib.module.js`) to their canonical manifest
    // route. normalizePath preserves case for the VFS physical-file probe;
    // only the endpoint-map lookup below case-folds via the lookupKey.
    const { path: virtualPath } = normalizePath(source);
    if (virtualPath === '') return null;

    for (const probe of new ExtensionProbes(virtualPath)) {
      const vfsHit = this.vfs.resolve(probe);
      if (vfsHit !== undefined) return vfsHit.physicalPath;

      const alias = this.endpointLookup.get(normalizePath(probe));
      if (alias !== undefined) {
        const resolved = this.vfs.resolve(alias.assetFile);
        if (resolved !== undefined) return resolved.physicalPath;

        const fsHit = this.vfs.resolveFile(alias.assetFile);
        if (fsHit !== undefined) return fsHit.physicalPath;
      }
    }

    return null;
  }

  /**
   * Return the canonical, fingerprint-free route for a specifier, or `null` if the specifier is unrecognized.
   */
  canonicalRoute(source: string): string | null {
    const { path } = normalizePath(source);
    if (path === '') return null;

    for (const probe of new ExtensionProbes(path)) {
      const match = this.endpointLookup.get(normalizePath(probe));
      if (match !== undefined) {
        // Fingerprinted endpoints carry a `label` pointing at their canonical
        // route; canonical endpoints have none, so the probe route is canonical.
        return match.label ?? probe;
      }
    }

    return null;
  }

  resolvePath(resolved: string | null, path: string, importer?: string): string | null {
    let assetPath: string | null = null;
    if (resolved !== null && BINARY_EXTENSIONS_REGEX.test(resolved)) {
      assetPath = resolved;
    } else if (BINARY_EXTENSIONS_REGEX.test(path) && importer) {
      assetPath = resolve(dirname(importer), path); // Sibling imports (`./dotnet.native.wasm`) aren't resolvable routes for us: resolve off the importer.
    }
    return assetPath;
  }

  headersFor(route: string): readonly ResponseHeader[] | undefined {
    return this.endpointLookup.get(normalizePath(route))?.responseHeaders;
  }

  /**
   * Enumerate the canonical routes this resolver knows about, skipping
   * fingerprint-alias endpoints (those carry a `label` pointing back to their
   * canonical route). Each yielded route is resolvable via {@link resolve}.
   */
  *routes(): IterableIterator<string> {
    for (const [route, match] of this.endpointLookup) {
      if (match.label === undefined) yield route;
    }
  }

  /**
   * @returns all physical content roots that the asset resolver covers
   */
  roots(): string[] {
    return this.vfs.listRoots();
  }
}
