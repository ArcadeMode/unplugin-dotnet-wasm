import type { Endpoint, EndpointsManifest, ResponseHeader } from '../manifest-parsing/manifest-endpoints';
import { normalizePath, type NormalizedPath } from '../path-utils';

export interface EndpointMatch {
  /** Physical file path relative to the .NET application root */
  readonly assetFile: string;
  /** Hash token */
  readonly fingerprint?: string;
  /**
   * If present, this is a fingerprinted endpoint and the label points back to the canonical route.
   */
  readonly label?: string;
  readonly responseHeaders: readonly ResponseHeader[];
}

/**
 * Route → EndpointMatch lookup table. Keyed internally by the case-folded
 * lookupKey and filled only via {@link set}, so callers can neither read nor
 * write with a raw un-normalized string — a mis-keyed instance cannot exist.
 */
export class EndpointLookup {
  private readonly map = new Map<string, EndpointMatch>();

  /**
   * Insert a route→match. The key is derived from `route.lookupKey`.
   * @throws {EndpointLookupBuildError} if the route is already present.
   */
  set(route: NormalizedPath, match: EndpointMatch): void {
    if (this.map.has(route.lookupKey)) {
      throw new EndpointLookupBuildError(
        `Duplicate endpoint route after normalisation: "${route.lookupKey}"`,
        route.lookupKey,
      );
    }
    this.map.set(route.lookupKey, match);
  }

  get(p: NormalizedPath): EndpointMatch | undefined { return this.map.get(p.lookupKey); }
  has(p: NormalizedPath): boolean { return this.map.has(p.lookupKey); }
  get size(): number { return this.map.size; }
  values(): IterableIterator<EndpointMatch> { return this.map.values(); }
  /** Iterate [route, match] entries. The route key is the case-folded lookupKey. */
  [Symbol.iterator](): IterableIterator<[string, EndpointMatch]> { return this.map[Symbol.iterator](); }
}

/**
 * Derive an {@link EndpointLookup} from a parsed endpoints manifest.
 *
 * - Compressed endpoints are ignored
 * - All routes and assetFile paths are POSIX-normalised and any leading `/` stripped
 *
 * @throws {EndpointLookupBuildError} if two uncompressed endpoints share the same
 *   normalised route.
 */
export function buildEndpointLookup(manifest: EndpointsManifest): EndpointLookup {
  const lookup = new EndpointLookup();

  for (const endpoint of manifest.Endpoints) {
    if (isCompressed(endpoint)) continue;

    const route = normalizePath(endpoint.Route);
    const assetFile = normalizePath(endpoint.AssetFile).path;
    lookup.set(route, extractMatch(assetFile, endpoint));
  }

  return lookup;
}

function isCompressed(endpoint: Endpoint): boolean {
  return endpoint.Selectors.some(s => s.Name === 'Content-Encoding');
}

function extractMatch(assetFile: string, endpoint: Endpoint): EndpointMatch {
  let fingerprint: string | undefined;
  let label: string | undefined;

  for (const prop of endpoint.EndpointProperties) {
    switch (prop.Name) {
      case 'fingerprint':
        fingerprint = prop.Value;
        break;
      case 'label':
        label = prop.Value;
        break;
    }
  }

  const result: EndpointMatch = { assetFile, responseHeaders: endpoint.ResponseHeaders };
  if (fingerprint !== undefined) (result as { fingerprint?: string }).fingerprint = fingerprint;
  if (label !== undefined) (result as { label?: string }).label = label;
  return result;
}

export class EndpointLookupBuildError extends Error {
  /** The route that appeared more than once. */
  readonly route: string;

  constructor(message: string, route: string) {
    super(message);
    this.name = 'EndpointLookupBuildError';
    this.route = route;
  }
}
