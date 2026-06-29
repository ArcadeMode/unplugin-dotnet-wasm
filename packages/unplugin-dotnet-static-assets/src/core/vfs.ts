import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ManifestNode, RuntimeManifest } from './manifest-runtime.js';
import { EXTENSION_PROBE_ORDER } from './extension-probe-order.js';
import { type Logger, NULL_LOGGER } from './logger.js';
import { hasExtension, stripLeadingSlash, toPosixPath } from './path-utils.js';

export interface ResolvedAsset {
  /** Virtual POSIX path relative to the VFS root (e.g. `_framework/dotnet.js`). */
  virtualPath: string;
  /** Absolute OS-native path to the physical file on disk. */
  physicalPath: string;
}

export interface ResolvedFile {
  /** Absolute OS-native path to the physical file on disk. */
  physicalPath: string;
}

export interface VirtualFileSystem {
  /**
   * List direct children of a virtual directory. Returns full paths (e.g. `['_framework/dotnet.js', '_framework/Library.wasm']`)
   * Only enumerates manifest-listed assets, other files that may reside on disk are not included.
   */
  list(virtualDir: string): string[];

  /**
   * Resolve a virtual path to its physical file.
   *
   * Resolution order:
   * 1. Exact lookup in VFS.
   * 2. For bare specifiers, attempt extension and index probing (.ts, .js, /index.<ext>, etc.) in VFS.
   * 3. Pattern fallthrough, for each manifest entry with a prefix `Patterns` match:
   *    1. Attempt exact lookup in FS.
   *    2. For bare specifiers, attempt extension and index probing in FS.
   *
   * Returns `undefined` when nothing matches. This does not mean the file is not on disk, just not in the virtual file system.
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

interface NodePattern {
  /** Virtual path prefix that scopes this pattern ('' = root). */
  nodePrefix: string;
  contentRootIndex: number;
  pattern: string;
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

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

/**
 * Build an in-memory virtual filesystem from a parsed runtime manifest.
 *
 * The VFS describes *only* what the manifest declares. Physical files can still be read from disk via `resolveFile()`, 
 * but they are not part of the VFS unless they are enumerated or fall under a matching pattern.
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

  function list(virtualDir: string): string[] {
    const norm = stripLeadingSlash(toPosixPath(virtualDir)).replace(/\/$/, '');
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
    const vp = stripLeadingSlash(toPosixPath(virtualPath));
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

  function resolveFile(assetFile: string): ResolvedFile | undefined {
    const posixFile = stripLeadingSlash(toPosixPath(assetFile));
    for (const rawRoot of manifest.ContentRoots) {
      const absPath = join(rawRoot, posixFile);
      if (isFile(absPath)) return { physicalPath: absPath };
    }
    return undefined;
  }

  return { list, resolve, resolveFile };
}

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
