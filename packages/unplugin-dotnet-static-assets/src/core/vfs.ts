import { existsSync, statSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import type { ManifestNode, RuntimeManifest } from './manifest-runtime.js';
import { EXTENSION_PROBE_ORDER } from './extension-probe-order.js';
import { type Logger, NULL_LOGGER } from './logger.js';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface ResolvedAsset {
  /** Virtual POSIX path relative to the VFS root (e.g. `_framework/dotnet.js`). */
  virtualPath: string;
  /** Absolute OS-native path to the physical file on disk. */
  physicalPath: string;
}

/**
 * Returned by {@link VirtualFileSystem.resolveFile}: a successful cross-root
 * FS probe for an exact asset filename (no extension or index probing).
 */
export interface ResolvedFile {
  /** Absolute OS-native path to the physical file on disk. */
  physicalPath: string;
}

export interface VirtualFileSystem {
  /**
   * List direct virtual children of a virtual directory.
   * Returns full virtual paths (e.g. `['_framework/dotnet.js', '_framework/Library.wasm']`),
   * sorted, original casing.  Only enumerates manifest-listed assets — pattern
   * fallthrough is lazy and cannot be enumerated without a directory scan.
   */
  list(virtualDir: string): string[];

  /**
   * Resolve a virtual path to its physical file.
   *
   * Resolution order:
   * 1. Exact map lookup.
   * 2. Extension probing (`EXTENSION_PROBE_ORDER`) against the map, for bare
   *    specifiers (no file extension).
   * 3. `<path>/index.<ext>` probing against the map, for bare specifiers.
   * 4. Pattern fallthrough — for each manifest `Patterns` entry whose virtual
   *    prefix matches `virtualPath`, `statSync` the candidate physical path
   *    under that pattern's content root.  Bare specifiers retry with each
   *    probe extension and with `/index.<ext>` suffixes.  Successful hits are
   *    cached back into `lookup`.
   *
   * Returns `undefined` when nothing matches.  Callers should treat this as
   * "not a virtual asset" and delegate to the host bundler's native resolver
   * (which will walk relative to the importer's physical location).
   */
  resolve(virtualPath: string): ResolvedAsset | undefined;

  /**
   * Locate an exact asset filename across all content roots via a targeted
   * `statSync` probe — no extension or index probing.
   *
   * Used for the endpoint-aliased FS fallback (§3.2 step 6): when the
   * endpoints manifest maps a route to a fingerprinted `AssetFile` that is
   * absent from the VFS flat map and not covered by a pattern, this walks the
   * content roots in declaration order and returns the first hit.
   *
   * Returns `undefined` when the file is absent from all roots.
   */
  resolveFile(assetFile: string): ResolvedFile | undefined;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface NodePattern {
  /** Virtual path prefix that scopes this pattern ('' = root). */
  nodePrefix: string;
  contentRootIndex: number;
  pattern: string;
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/** Convert an OS path to forward-slash POSIX form. No-op on Linux/macOS. */
function toPosix(p: string): string {
  return sep === '\\' ? p.replace(/\\/g, '/') : p;
}

function stripLeadingSlash(p: string): string {
  return p.startsWith('/') ? p.slice(1) : p;
}

/**
 * Returns true when the last path segment contains a `.` after its first
 * character (so `dotnet.js` → true, `wasm-bootstrap` → false,
 * `.gitignore` → false).
 */
function hasExtension(posixPath: string): boolean {
  const base = posixPath.split('/').pop() ?? '';
  return base.lastIndexOf('.') > 0;
}

/** statSync that returns true iff the path exists and is a regular file. */
function isFile(absPath: string): boolean {
  try {
    return !statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Manifest tree walkers
// ---------------------------------------------------------------------------

/**
 * Depth-first walk of the manifest node tree.
 * Inserts an entry for every node that carries an explicit `Asset`.
 */
function collectManifestAssets(
  node: ManifestNode,
  rawRoots: string[],
  segments: string[],
  out: Map<string, ResolvedAsset>,
): void {
  if (node.Asset !== null) {
    const rootDir = rawRoots[node.Asset.ContentRootIndex];
    if (rootDir !== undefined) {
      const virtualPath = segments.join('/');
      out.set(virtualPath.toLowerCase(), {
        virtualPath,
        physicalPath: join(rootDir, node.Asset.SubPath),
      });
    }
  }
  if (node.Children !== null) {
    for (const [segment, child] of Object.entries(node.Children)) {
      collectManifestAssets(child, rawRoots, [...segments, segment], out);
    }
  }
}

/**
 * Collect all `Patterns` entries from the tree, annotated with the virtual
 * path prefix they are scoped to.
 */
function collectPatterns(node: ManifestNode, segments: string[]): NodePattern[] {
  const out: NodePattern[] = [];
  if (node.Patterns !== null) {
    const prefix = segments.join('/');
    for (const p of node.Patterns) {
      out.push({ nodePrefix: prefix, contentRootIndex: p.ContentRootIndex, pattern: p.Pattern });
    }
  }
  if (node.Children !== null) {
    for (const [segment, child] of Object.entries(node.Children)) {
      out.push(...collectPatterns(child, [...segments, segment]));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// VFS builder
// ---------------------------------------------------------------------------

/**
 * Build an in-memory virtual filesystem from a parsed runtime manifest.
 *
 * The VFS describes *only* what the manifest declares to be virtual:
 *
 *   - Every explicit `Asset` node becomes an entry in {@link VirtualFileSystem.lookup}.
 *   - Every `Patterns` entry becomes a lazy fallthrough rule evaluated on miss
 *     in {@link VirtualFileSystem.resolve} via a single `statSync` per content
 *     root + probe extension (no directory enumeration).
 *
 * Files that exist on disk but are not enumerated and do not fall under a
 * matching pattern are **not** part of the VFS.  Callers (e.g. the bundler
 * resolveId hook) should treat a `resolve()` miss as a signal to delegate to
 * the host bundler's native resolver, which walks relative to the importer's
 * physical location.  This keeps the plugin focused on injecting the manifest
 * overlay; the bundler handles every other file in the project the way it
 * normally would.
 */
export function buildVfs(manifest: RuntimeManifest, opts?: { logger?: Logger }): VirtualFileSystem {
  const logger = opts?.logger ?? NULL_LOGGER;

  // ── Step 1: ingest every explicit `Asset` node from the manifest. ──
  const lookup = new Map<string, ResolvedAsset>();
  collectManifestAssets(manifest.Root, manifest.ContentRoots, [], lookup);

  // ── Step 2: pre-compile manifest patterns for lazy fallthrough. ──
  const patterns = collectPatterns(manifest.Root, []);

  // ── Step 3: detect .ts / .d.ts shadowed pairs and emit debug warnings. ──
  for (const [key, asset] of lookup) {
    if (!key.endsWith('.d.ts')) continue;
    const baseKey = key.slice(0, -'.d.ts'.length);
    const tsHit = lookup.get(`${baseKey}.ts`);
    if (tsHit !== undefined && !tsHit.physicalPath.endsWith('.d.ts')) {
      logger.debug(
        `".ts" shadows ".d.ts": "${tsHit.virtualPath}" takes precedence over "${asset.virtualPath}"`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // list()
  // ---------------------------------------------------------------------------

  function list(virtualDir: string): string[] {
    const norm = stripLeadingSlash(toPosix(virtualDir)).replace(/\/$/, '');
    const prefix = norm === '' ? '' : `${norm}/`;
    const prefixKey = prefix.toLowerCase();
    const found: string[] = [];

    for (const [key, asset] of lookup) {
      if (!key.startsWith(prefixKey)) continue;
      const rest = key.slice(prefixKey.length);
      if (!rest.includes('/')) {
        found.push(asset.virtualPath);
      }
    }

    return found.sort();
  }

  // ---------------------------------------------------------------------------
  // resolve()
  // ---------------------------------------------------------------------------

  /**
   * Try a candidate physical path: stat once; on a regular-file hit, cache the
   * result into `lookup` and return it.  Returns `undefined` on miss.
   */
  function tryStatCandidate(
    candidateVirtualPath: string,
    candidatePhysicalPath: string,
  ): ResolvedAsset | undefined {
    if (!isFile(candidatePhysicalPath)) return undefined;
    const asset: ResolvedAsset = {
      virtualPath: candidateVirtualPath,
      physicalPath: candidatePhysicalPath,
    };
    lookup.set(candidateVirtualPath.toLowerCase(), asset);
    return asset;
  }

  function resolve(virtualPath: string): ResolvedAsset | undefined {
    const vp = stripLeadingSlash(toPosix(virtualPath));
    const key = vp.toLowerCase();

    // 1. Exact map lookup.
    const exact = lookup.get(key);
    if (exact !== undefined) return exact;

    const bare = !hasExtension(vp);

    if (bare) {
      // 2. Extension probing against the map.
      for (const ext of EXTENSION_PROBE_ORDER) {
        const hit = lookup.get(`${key}${ext}`);
        if (hit !== undefined) return hit;
      }
      // 3. `<path>/index.<ext>` probing against the map.
      for (const ext of EXTENSION_PROBE_ORDER) {
        const hit = lookup.get(`${key}/index${ext}`);
        if (hit !== undefined) return hit;
      }
    }

    // 4. Pattern fallthrough — single targeted stat per candidate; no scans.
    for (const pat of patterns) {
      const rawRoot = manifest.ContentRoots[pat.contentRootIndex];
      if (rawRoot === undefined) continue;

      // The pattern only applies if `vp` falls within its virtual subtree.
      if (pat.nodePrefix !== '' && !vp.startsWith(`${pat.nodePrefix}/`)) continue;

      // M1 only honours the most common pattern shape: `**` (everything below
      // the node).  More elaborate glob support lands when a real-world
      // manifest demands it.
      if (pat.pattern !== '**') continue;

      // 4a. Direct hit at the verbatim path.
      const direct = tryStatCandidate(vp, join(rawRoot, vp));
      if (direct !== undefined) return direct;

      if (bare) {
        // 4b. Extension probing through the pattern.
        for (const ext of EXTENSION_PROBE_ORDER) {
          const hit = tryStatCandidate(`${vp}${ext}`, join(rawRoot, `${vp}${ext}`));
          if (hit !== undefined) return hit;
        }
        // 4c. `<vp>/index.<ext>` probing through the pattern.
        for (const ext of EXTENSION_PROBE_ORDER) {
          const hit = tryStatCandidate(`${vp}/index${ext}`, join(rawRoot, vp, `index${ext}`));
          if (hit !== undefined) return hit;
        }
      }
    }

    return undefined;
  }

  // ---------------------------------------------------------------------------
  // resolveFile()
  // ---------------------------------------------------------------------------

  function resolveFile(assetFile: string): ResolvedFile | undefined {
    const posixFile = stripLeadingSlash(toPosix(assetFile));
    for (const rawRoot of manifest.ContentRoots) {
      const absPath = join(rawRoot, posixFile);
      if (isFile(absPath)) return { physicalPath: absPath };
    }
    return undefined;
  }

  return { list, resolve, resolveFile };
}

/**
 * Return a {@link VirtualFileSystem} with no manifest-enumerated assets.
 *
 * When `endpointsManifestPath` is supplied (Mode B — no runtime manifest),
 * a single content root is derived from the endpoints manifest location and a
 * catch-all `**` pattern is registered against it.  This lets the normal
 * pattern-fallthrough path in {@link VirtualFileSystem.resolve} discover any
 * file that exists in the publish output without requiring Mode-B-specific
 * branches in callers.
 *
 * Standard `dotnet publish` layout: `<publish>/wwwroot/<assetFile>`.
 * If a `wwwroot/` subdirectory exists next to the endpoints manifest that
 * directory is used as the root; otherwise the manifest's own directory is.
 *
 * Called with no argument it returns a truly empty VFS (O(1) misses on all
 * lookups), used as a pre-{@link buildStart} placeholder.
 */
export function buildEmptyVfs(endpointsManifestPath?: string, opts?: { logger?: Logger }): VirtualFileSystem {
  if (!endpointsManifestPath) {
    return buildVfs(
      {
        ContentRoots: [],
        Root: {
          Children: null,
          Asset: null,
          Patterns: [],
        },
      },
      opts,
    );
  }

  const manifestDir = dirname(endpointsManifestPath);
  const wwwroot = join(manifestDir, 'wwwroot');
  const contentRoot = existsSync(wwwroot) ? wwwroot : manifestDir;

  return buildVfs(
    {
      ContentRoots: [contentRoot],
      Root: {
        Children: null,
        Asset: null,
        Patterns: [{ ContentRootIndex: 0, Pattern: '**', Depth: 0 }],
      },
    },
    opts,
  );
}
