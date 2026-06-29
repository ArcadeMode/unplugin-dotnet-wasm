import type { Endpoint, EndpointsManifest } from './manifest-endpoints.js';
import { stripLeadingSlash, toPosixPath } from './path-utils.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Resolved metadata for a single un-compressed endpoint, keyed by its POSIX
 * route (no leading slash).
 */
export interface EndpointMatch {
  /** Physical file path relative to the build/publish root (POSIX, no leading slash). */
  readonly assetFile: string;
  /** SRI hash value from EndpointProperties where Name === 'integrity', if present. */
  readonly integrity?: string;
  /** Hash token from EndpointProperties where Name === 'fingerprint', if present. */
  readonly fingerprint?: string;
  /**
   * Canonical route alias from EndpointProperties where Name === 'label', if present.
   * The fingerprinted endpoint row (`_framework/dotnet.<fp>.js`) carries this label
   * pointing back to the canonical route (`_framework/dotnet.js`).
   */
  readonly label?: string;
}

/** Immutable route → EndpointMatch lookup table. */
export type EndpointLookup = ReadonlyMap<string, EndpointMatch>;

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Derive an {@link EndpointLookup} from a parsed endpoints manifest.
 *
 * Rules applied:
 *  1. Endpoints whose `Selectors` contain an entry with `Name === 'Content-Encoding'`
 *     are **skipped** — they are compressed variants; the underlying bits are the
 *     same as the uncompressed endpoint, so we only need one canonical entry per
 *     route.
 *  2. Routes are POSIX-normalised and any leading `/` stripped.
 *  3. AssetFile is POSIX-normalised and any leading `/` stripped.
 *  4. The `integrity`, `fingerprint`, and `label` EndpointProperty values are
 *     extracted from `EndpointProperties` when present.
 *  5. Duplicate routes (after normalisation) throw an
 *     {@link EndpointLookupBuildError}.
 *
 * @throws {EndpointLookupBuildError} if two uncompressed endpoints share the same
 *   normalised route.
 */
export function buildEndpointLookup(manifest: EndpointsManifest): EndpointLookup {
  const map = new Map<string, EndpointMatch>();

  for (const endpoint of manifest.Endpoints) {
    if (isCompressed(endpoint)) continue;

    const route = normalisePath(endpoint.Route);
    const assetFile = normalisePath(endpoint.AssetFile);
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isCompressed(endpoint: Endpoint): boolean {
  return endpoint.Selectors.some(s => s.Name === 'Content-Encoding');
}

function normalisePath(p: string): string {
  return stripLeadingSlash(toPosixPath(p));
}

function extractMatch(assetFile: string, endpoint: Endpoint): EndpointMatch {
  let integrity: string | undefined;
  let fingerprint: string | undefined;
  let label: string | undefined;

  for (const prop of endpoint.EndpointProperties) {
    switch (prop.Name) {
      case 'integrity':
        integrity = prop.Value;
        break;
      case 'fingerprint':
        fingerprint = prop.Value;
        break;
      case 'label':
        label = prop.Value;
        break;
    }
  }

  const result: EndpointMatch = { assetFile };
  if (integrity !== undefined) (result as { integrity?: string }).integrity = integrity;
  if (fingerprint !== undefined) (result as { fingerprint?: string }).fingerprint = fingerprint;
  if (label !== undefined) (result as { label?: string }).label = label;
  return result;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class EndpointLookupBuildError extends Error {
  /** The route that appeared more than once. */
  readonly route: string;

  constructor(message: string, route: string) {
    super(message);
    this.name = 'EndpointLookupBuildError';
    this.route = route;
  }
}
