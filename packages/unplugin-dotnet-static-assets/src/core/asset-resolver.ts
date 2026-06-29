import { sep } from 'node:path';
import type { VirtualFileSystem } from './vfs.js';
import type { EndpointLookup } from './endpoint-lookup.js';
import { EXTENSION_PROBE_ORDER } from './extension-probe-order.js';

/**
 * Resolves bare/virtual import specifiers against a manifest-backed VFS,
 * with endpoint-route aliasing for fingerprinted asset filenames.
 *
 * Stateless with respect to the build lifecycle — holds no I/O and performs no
 * manifest state of its own. Constructed once per {@link buildStart} with a
 * fresh VFS and endpoint lookup; the {@link resolve} method is then called
 * once per {@link resolveId} invocation.
 */
export class AssetResolver {
  constructor(
    private readonly vfs: VirtualFileSystem,
    private readonly endpointLookup: EndpointLookup,
  ) {}

  /**
   * Resolve a bundler `source` specifier to an absolute physical path.
   *
   * Resolution order (mirrors §3.2 of the spec):
   * 1. Normalise: strip leading `./` or `/`, convert to POSIX.
   * 2. For bare specifiers, expand into `[bare, bare.ts, bare.tsx, …]` probes.
   * 3. For each probe: try `vfs.resolve`; on hit, return the physical path.
   * 4. For each probe: try the endpoint-alias map; on alias hit, try
   *    `vfs.resolve(alias.assetFile)`, then `vfs.resolveFile(alias.assetFile)`.
   * 5. Full miss → return `null` so the host bundler's native resolver carries on.
   */
  resolve(source: string): string | null {
    const virtualPath = AssetResolver.stripLeadingSlashOrDot(AssetResolver.toPosixPath(source));
    if (virtualPath === '') return null;

    const pathProbes: string[] = AssetResolver.hasExtension(virtualPath)
      ? [virtualPath]
      : [virtualPath, ...EXTENSION_PROBE_ORDER.map(ext => `${virtualPath}${ext}`)];

    for (const pathProbe of pathProbes) {
      const vfsHit = this.vfs.resolve(pathProbe);
      if (vfsHit !== undefined) return vfsHit.physicalPath;

      const alias = this.endpointLookup.get(pathProbe);
      if (alias !== undefined) {
        const resolved = this.vfs.resolve(alias.assetFile);
        if (resolved !== undefined) return resolved.physicalPath;

        const fsHit = this.vfs.resolveFile(alias.assetFile);
        if (fsHit !== undefined) return fsHit.physicalPath;
      }
    }

    return null;
  }

  private static toPosixPath(p: string): string {
    return sep === '\\' ? p.replace(/\\/g, '/') : p;
  }

  private static stripLeadingSlashOrDot(p: string): string {
    return p.replace(/^\.\//u, '').replace(/^\//u, '');
  }

  private static hasExtension(posixPath: string): boolean {
    const base = posixPath.split('/').at(-1) ?? '';
    return base.lastIndexOf('.') > 0;
  }
}
