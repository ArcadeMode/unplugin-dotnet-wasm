import type { Endpoint, EndpointsManifest, ResponseHeader } from '../manifest-parsing/manifest-endpoints';
import { normalizePath } from '../path-utils';

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

/** Immutable route → EndpointMatch lookup table. */
export type EndpointLookup = ReadonlyMap<string, EndpointMatch>;

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
  const map = new Map<string, EndpointMatch>();

  for (const endpoint of manifest.Endpoints) {
    if (isCompressed(endpoint)) continue;

    const route = normalizePath(endpoint.Route).lookupKey;
    const assetFile = normalizePath(endpoint.AssetFile).path;
    const match = extractMatch(assetFile, endpoint);

    if (map.has(route)) {
      throw new EndpointLookupBuildError(
        `Duplicate endpoint route after normalisation: "${route}"`,
        route,
      );
    }

    map.set(route, match);
  }

  return map;
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
