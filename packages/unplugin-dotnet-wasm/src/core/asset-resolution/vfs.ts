import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ManifestNode, RuntimeManifest } from '../manifest-parsing/manifest-runtime';
import { type Logger, NULL_LOGGER } from '../logger';
import { stripLeadingSlash, toPosixPath } from '../path-utils';

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
   * 1. Exact lookup in the manifest-built map.
   * 2. For each `**` pattern: a single `statSync` at the verbatim path under
   *    the pattern's content root, with hits cached into the map.
   *
   * No extension or index probing here — callers expand specifiers upstream.
   * Returns `undefined` when nothing matches.
   */
  resolve(virtualPath: string): ResolvedAsset | undefined;

  /**
   * Locate an exact asset filename across all content roots via a targeted
   * `statSync` probe — no extension or index probing.
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

/**
 * statSync that returns true iff the path exists and is a regular file.
 */
function isFile(absPath: string): boolean {
  try {
    return !statSync(absPath).isDirectory(); // sync kept for simplicity and negiligible cost on the manifest-miss fallback path
  } catch {
    return false;
  }
}

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

  const patternCount = patterns.filter(p => p.pattern === '**').length;
  logger.info(
    `VFS constructed: ${lookup.size} manifest assets, ${manifest.ContentRoots.length} content root(s), ${patternCount} fallthrough pattern(s)`,
  );

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

    const exact = lookup.get(key);
    if (exact !== undefined) return exact;

    for (const pat of patterns) {
      const rawRoot = manifest.ContentRoots[pat.contentRootIndex];
      if (rawRoot === undefined) continue;
      if (pat.nodePrefix !== '' && !vp.startsWith(`${pat.nodePrefix}/`)) continue;
      // Only `**` is honoured today; richer glob shapes can land when needed.
      if (pat.pattern !== '**') continue;

      const candidatePhysicalPath = join(rawRoot, vp);
      const hit = tryStatCandidate(vp, candidatePhysicalPath);
      if (hit !== undefined) {
        logger.debug(`resolved via pattern: "${vp}" → "${candidatePhysicalPath}"`);
        return hit;
      }
    }

    logger.debug(`could not resolve: "${vp}"`);
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
  const logger = opts?.logger ?? NULL_LOGGER;

  if (!endpointsManifestPath) {
    logger.debug('no manifest path: falling back to empty VFS');
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
  const rootLabel = existsSync(wwwroot) ? 'wwwroot' : 'manifest dir';

  logger.debug(`building single-root VFS from endpoints manifest using ${rootLabel}`);

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
