import type { VirtualFileSystem } from './vfs';
import type { EndpointLookup } from './endpoint-lookup';
import type { ResponseHeader } from '../manifest-parsing/manifest-endpoints';
import { ExtensionProbes } from './extension-probes';
import { collapseDotSegments, normalizeRoute, toPosixPath } from '../path-utils';

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
    // route. Case is PRESERVED here: the probe also drives the VFS physical-file
    // lookup, which must match on-disk casing on case-sensitive filesystems.
    // Case-folding happens only on the endpoint-map lookup below.
    const virtualPath = collapseDotSegments(toPosixPath(source));
    if (virtualPath === '') return null;

    for (const probe of new ExtensionProbes(virtualPath)) {
      const vfsHit = this.vfs.resolve(probe);
      if (vfsHit !== undefined) return vfsHit.physicalPath;

      const alias = this.endpointLookup.get(normalizeRoute(probe));
      if (alias !== undefined) {
        const resolved = this.vfs.resolve(alias.assetFile);
        if (resolved !== undefined) return resolved.physicalPath;

        const fsHit = this.vfs.resolveFile(alias.assetFile);
        if (fsHit !== undefined) return fsHit.physicalPath;
      }
    }

    return null;
  }

  headersFor(route: string): readonly ResponseHeader[] | undefined {
    const key = normalizeRoute(route);
    return this.endpointLookup.get(key)?.responseHeaders;
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
}
