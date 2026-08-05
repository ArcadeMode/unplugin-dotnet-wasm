import { VIRTUAL_ROUTE_PREFIX } from '../constants';
import { toPosixPath } from '../path-utils';

// Farm messes up the leading `\0` in virtual ids, so we we ignore it in checks.
export const VIRTUAL_ROUTE_MARKER = VIRTUAL_ROUTE_PREFIX.slice(1);

export function toVirtualId(route: string): string {
  return VIRTUAL_ROUTE_PREFIX + route;
}

export function isVirtualId(id: string): boolean {
  return id.includes(VIRTUAL_ROUTE_MARKER);
}

export function routeFromVirtualId(id: string | undefined): string | null {
  if (!id) return null;
  if (id.startsWith(VIRTUAL_ROUTE_PREFIX)) return id.slice(VIRTUAL_ROUTE_PREFIX.length);
  if (!id.includes(VIRTUAL_ROUTE_MARKER)) return null;

  let decoded = id;
  try {
    decoded = decodeURIComponent(id);
  } catch {
    // ignore malformed percent-encoding
  }

  const idx = decoded.indexOf(VIRTUAL_ROUTE_MARKER);
  return idx === -1 ? null : toPosixPath(decoded.slice(idx + VIRTUAL_ROUTE_MARKER.length));
}
