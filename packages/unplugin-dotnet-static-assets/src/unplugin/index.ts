import { createUnplugin } from 'unplugin';
import { readFileSync, statSync as fsStatSync } from 'node:fs';
import { basename, join, sep } from 'node:path';
import type { DotnetAssetsOptions } from '../types.js';
import { discoverRuntimeManifest, discoverEndpointsManifest } from '../core/discover.js';
import { parseRuntimeManifest } from '../core/manifest-runtime.js';
import { parseEndpointsManifest } from '../core/manifest-endpoints.js';
import { buildEndpointLookup, type EndpointLookup } from '../core/endpoint-lookup.js';
import { buildVfs, type VirtualFileSystem, EXTENSION_PROBE_ORDER } from '../core/vfs.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BINARY_EXTENSIONS = new Set(['.wasm', '.dat', '.pdb']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toPosix(p: string): string {
  return sep === '\\' ? p.replace(/\\/g, '/') : p;
}

/** Strip a single leading `./` or `/` from a virtual-path specifier. */
function stripLeadingSlashOrDot(p: string): string {
  return p.replace(/^\.\//u, '').replace(/^\//u, '');
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

/**
 * Walk `contentRoots` (POSIX with trailing slash) for `assetFile` (POSIX,
 * no leading slash).  Returns the first hit's absolute OS-native path, or
 * `null` when the file is absent from all roots.
 *
 * Used as the §3.2 step-6 "endpoint-aliased FS fallback" when the endpoints
 * manifest maps a canonical route to a fingerprinted AssetFile that the
 * runtime manifest did not enumerate explicitly.
 */
function statAcrossRoots(assetFile: string, contentRoots: readonly string[]): string | null {
  for (const root of contentRoots) {
    // contentRoots are POSIX with trailing slash; path.join normalises on the current OS.
    const absPath = join(root, assetFile);
    try {
      if (!fsStatSync(absPath).isDirectory()) return absPath;
    } catch {
      // miss — try the next root
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

export const dotnetStaticAssets = createUnplugin((options: DotnetAssetsOptions) => {
  let vfs: VirtualFileSystem | null = null;
  let endpointLookup: EndpointLookup | null = null;
  const logLevel = options.logLevel ?? 'warn';

  return {
    name: 'unplugin-dotnet-static-assets',
    enforce: 'pre' as const,

    async buildStart() {
      const discovered = discoverRuntimeManifest({
        projectRoot: options.projectRoot,
        ...(options.configuration !== undefined && { configuration: options.configuration }),
        ...(options.targetFramework !== undefined && { targetFramework: options.targetFramework }),
        ...(options.manifestPath !== undefined && { manifestPath: options.manifestPath }),
      });

      const manifest = parseRuntimeManifest(readFileSync(discovered.manifestPath));
      vfs = buildVfs(manifest);

      // Load the endpoints manifest for fingerprint-aware resolution (§3.2 step 2 + 4b).
      // Optional: absent on older SDK versions or unusual layouts; silently skipped.
      const endpointsPath = discoverEndpointsManifest(discovered);
      if (endpointsPath !== null) {
        const endpointsManifest = parseEndpointsManifest(readFileSync(endpointsPath));
        endpointLookup = buildEndpointLookup(endpointsManifest);
      }

      // One-shot debug log per shadowed .ts / .d.ts pair.
      if (logLevel === 'debug' || logLevel === 'info') {
        for (const p of vfs.shadowedPairs) {
          if (!p.endsWith('.d.ts')) continue;
          const tsPath = `${p.slice(0, -'.d.ts'.length)}.ts`;
          console.debug(
            `[dotnet-static-assets] .ts shadows .d.ts: "${tsPath}" takes precedence over "${p}"`,
          );
        }
      }
    },

    resolveId(source: string) {
      if (vfs === null) return null;

      const virtualPath = stripLeadingSlashOrDot(toPosix(source));
      if (virtualPath === '') return null;

      const probes: string[] = hasExtension(virtualPath)
        ? [virtualPath]
        : [virtualPath, ...EXTENSION_PROBE_ORDER.map(ext => `${virtualPath}${ext}`)];

      for (const probe of probes) {
        // §3.2 Steps 2–3: VFS lookup (exact, ext-probing, patterns) then endpoint alias.
        const vfsHit = vfs.resolve(probe);
        if (vfsHit !== undefined) return vfsHit.physicalPath;

        // §3.2 Steps 2/4b: Endpoint alias maps a canonical route to its fingerprinted AssetFile.
        if (endpointLookup !== null) {
          const alias = endpointLookup.get(probe);
          if (alias !== undefined) {
            const resolved = vfs.resolve(alias.assetFile);
            if (resolved !== undefined) return resolved.physicalPath;
            // §3.2 Step 6: FS fallback for fingerprinted files absent from the VFS tree.
            const fsHit = statAcrossRoots(alias.assetFile, vfs.contentRoots);
            if (fsHit !== null) return fsHit;
          }
        }
      }

      return null;
    },

    load(id: string) {
      // Binary file types are emitted as static assets; text files (.ts, .js,
      // .json, …) fall through so Vite's own transformers handle them.
      const lastDot = id.lastIndexOf('.');
      if (lastDot === -1) return null;
      const ext = id.slice(lastDot);
      if (!BINARY_EXTENSIONS.has(ext)) return null;

      const source = readFileSync(id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const refId = this.emitFile({
        type: 'asset',
        name: basename(id),
        source,
      });
      return `export default import.meta.ROLLUP_FILE_URL_${refId};`;
    },
  };
});
