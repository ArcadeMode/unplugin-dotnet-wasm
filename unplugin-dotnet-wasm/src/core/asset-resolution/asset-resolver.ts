import type { VirtualFileSystem } from './vfs';
import type { EndpointLookup } from './endpoint-lookup';
import type { ResponseHeader } from '../manifest-parsing/manifest-endpoints';
import { ExtensionProbes } from './extension-probes';
import { normalizePath } from '../path-utils';
import { resolve, dirname } from 'node:path';
import { BINARY_EXTENSIONS_REGEX } from '../constants';

export class AssetResolver {
  constructor(
    private readonly vfs: VirtualFileSystem,
    private readonly endpointLookup: EndpointLookup,
  ) {}

  resolve(source: string): string | null {
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

  canonicalRoute(source: string): string | null {
    const { path } = normalizePath(source);
    if (path === '') return null;

    for (const probe of new ExtensionProbes(path)) {
      const match = this.endpointLookup.get(normalizePath(probe));
      if (match !== undefined) {
        // Fingerprinted endpoints use `label` for the canonical route; bare ones have none.
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

  // Skips fingerprint-alias endpoints (those with a `label`).
  *routes(): IterableIterator<string> {
    for (const [route, match] of this.endpointLookup) {
      if (match.label === undefined) yield route;
    }
  }

  roots(): string[] {
    return this.vfs.listRoots();
  }
}
