import type { VirtualFileSystem } from './vfs';
import type { EndpointLookup } from './endpoint-lookup';
import type { ResponseHeader } from '../manifest-parsing/manifest-endpoints';
import { ExtensionProbes } from './extension-probes';
import { normalizePath } from '../path-utils';
import { resolve, dirname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { BINARY_EXTENSIONS_REGEX, FRAMEWORK_JS_REGEX } from '../constants';

/** SDK lists these in Debug endpoints even when the files are not copied to a content root. */
const HOTRELOAD_ASSET_RE = /microsoft\.dotnet\.hotreload/i;

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

  /**
   * The bundler watch/dev file watchers are racing the MSBuild output writer. To avoid building mid-write,
   * wait for the disk to contain all files+integrities that the manifest lists.
   * @returns true if all files are on disk with correct integrities, false if not
   */
  async checkAssetsOnDisk(): Promise<boolean> {
    for (const [route, match] of this.endpointLookup) {
      if (!route.startsWith('_framework/')) continue;
      if (HOTRELOAD_ASSET_RE.test(route) || HOTRELOAD_ASSET_RE.test(match.assetFile)) continue;
      if (
        !isFrameworkJsPath(route) &&
        !isFrameworkJsPath(match.assetFile) &&
        !BINARY_EXTENSIONS_REGEX.test(match.assetFile)
      ) {
        continue;
      }

      const file = this.vfs.resolveFile(match.assetFile);
      if (file === undefined || file.size === 0) return false;

      if (match.fingerprint !== undefined) continue;
      if (BINARY_EXTENSIONS_REGEX.test(match.assetFile)) continue;
      if (this.endpointLookup.get(normalizePath(match.assetFile))?.fingerprint !== undefined) {
        continue;
      }

      const etag = match.responseHeaders.find((h) => h.Name === 'ETag')?.Value;
      if (etag !== undefined && !(await bytesMatchEtag(file.physicalPath, etag))) return false;
    }
    return true;
  }

  roots(): string[] {
    return this.vfs.listRoots();
  }
}

function isFrameworkJsPath(path: string): boolean {
  const posix = path.replace(/\\/g, '/');
  return FRAMEWORK_JS_REGEX.test(posix.startsWith('/') ? posix : `/${posix}`);
}

async function bytesMatchEtag(physicalPath: string, etag: string): Promise<boolean> {
  try {
    const digest = createHash('sha256')
      .update(await readFile(physicalPath))
      .digest('base64');
    return etag.replace(/^W\//, '').replace(/^"|"$/g, '') === digest;
  } catch {
    return false;
  }
}
