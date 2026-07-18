/** Convert backslash separators to POSIX forward slashes. */
export function toPosixPath(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Strip one or more leading `/` characters. */
export function stripLeadingSlash(p: string): string {
  return p.replace(/^\/+/u, '');
}

/** Strip a single leading `./` then any leading `/`. */
export function stripLeadingSlashOrDot(p: string): string {
  return stripLeadingSlash(p.replace(/^\.\//u, ''));
}

/**
 * Collapse a POSIX path to canonical form: drop empty and `.` segments,
 * resolve `..`. Assumes POSIX input — run toPosixPath first if unsure.
 */
export function collapseDotSegments(posixPath: string): string {
  const out: string[] = [];
  for (const seg of posixPath.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { out.pop(); continue; }
    out.push(seg);
  }
  return out.join('/');
}

/** Canonical key for endpoint-route lookups: POSIX, dot-segments collapsed, case-folded. */
export function normalizeRoute(p: string): string {
  return collapseDotSegments(toPosixPath(p)).toLowerCase();
}

/**
 * True when the last path segment contains a `.` after its first character.
 * `dotnet.js` → true, `wasm-bootstrap` → false, `.gitignore` → false.
 */
export function hasExtension(posixPath: string): boolean {
  const base = posixPath.split('/').at(-1) ?? '';
  return base.lastIndexOf('.') > 0;
}
