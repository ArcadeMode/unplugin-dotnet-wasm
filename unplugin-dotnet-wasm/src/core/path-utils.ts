/** Convert backslash separators to POSIX forward slashes. */
export function toPosixPath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Collapse a POSIX path to canonical form: drop empty and `.` segments,
 * resolve `..`. Assumes POSIX input — run toPosixPath first if unsure.
 */
export function collapseDotSegments(posixPath: string): string {
  const out: string[] = [];
  for (const seg of posixPath.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.join('/');
}

declare const normalizedPathBrand: unique symbol;

export interface NormalizedPath {
  /**
   * Canonical POSIX form: separators normalised, `.`/`..`/empty segments
   * collapsed, case PRESERVED. Use for filesystem access — case-sensitive on
   * non-Windows hosts.
   */
  readonly path: string;
  /**
   * `path` lower-cased: the canonical key for case-insensitive lookup maps
   * (the VFS asset map and the endpoint route map). Never stat this.
   */
  readonly lookupKey: string;
  readonly [normalizedPathBrand]: never;
}

/**
 * Canonical form of a virtual/physical path: POSIX separators with empty and
 * `.`/`..` segments collapsed. Case is PRESERVED in `path`; `lookupKey` is
 * the case-folded key for use in case-insensitive lookup maps.
 */
export function normalizePath(p: string): NormalizedPath {
  const path = collapseDotSegments(toPosixPath(p));
  return { path, lookupKey: path.toLowerCase() } as NormalizedPath;
}

/**
 * True when the last path segment contains a `.` after its first character.
 * `dotnet.js` → true, `wasm-bootstrap` → false, `.gitignore` → false.
 */
export function hasExtension(posixPath: string): boolean {
  const base = posixPath.split('/').at(-1) ?? '';
  return base.lastIndexOf('.') > 0;
}
