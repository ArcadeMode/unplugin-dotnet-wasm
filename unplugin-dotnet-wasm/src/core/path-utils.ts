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

export function normalizeVirtualPath(p: string): string {
  const out: string[] = [];
  for (const seg of toPosixPath(p).split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { out.pop(); continue; }
    out.push(seg);
  }
  return out.join('/');
}

/**
 * True when the last path segment contains a `.` after its first character.
 * `dotnet.js` → true, `wasm-bootstrap` → false, `.gitignore` → false.
 */
export function hasExtension(posixPath: string): boolean {
  const base = posixPath.split('/').at(-1) ?? '';
  return base.lastIndexOf('.') > 0;
}
