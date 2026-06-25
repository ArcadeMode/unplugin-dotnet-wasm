import { createUnplugin } from 'unplugin';
import { readFileSync } from 'node:fs';
import { basename, sep } from 'node:path';
import type { DotnetAssetsOptions } from '../types.js';
import { discoverRuntimeManifest } from '../core/discover.js';
import { parseRuntimeManifest } from '../core/manifest-runtime.js';
import { buildVfs, type VirtualFileSystem } from '../core/vfs.js';

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

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

export const dotnetStaticAssets = createUnplugin((options: DotnetAssetsOptions) => {
  let vfs: VirtualFileSystem | null = null;
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

      // The VFS is an importer-blind overlay: strip a leading './' or '/'
      // and POSIX-normalise.  Relative-path semantics for non-virtual files
      // are left to the host bundler's native resolver.
      const virtualPath = stripLeadingSlashOrDot(toPosix(source));
      if (virtualPath === '') return null;

      const asset = vfs.resolve(virtualPath);
      return asset !== undefined ? asset.physicalPath : null;
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
      const refId = (this as any).emitFile({
        type: 'asset',
        name: basename(id),
        source,
      });
      return `export default import.meta.ROLLUP_FILE_URL_${refId};`;
    },
  };
});
