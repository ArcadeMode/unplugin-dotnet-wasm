import { createUnplugin } from 'unplugin';
import { readFileSync } from 'node:fs';
import { basename, sep } from 'node:path';
import type { DotnetAssetsOptions } from '../types.js';
import { discoverManifests } from '../core/discover.js';
import { parseRuntimeManifest } from '../core/manifest-runtime.js';
import { parseEndpointsManifest } from '../core/manifest-endpoints.js';
import { buildEndpointLookup, EMPTY_ENDPOINT_LOOKUP, type EndpointLookup } from '../core/endpoint-lookup.js';
import { buildVfs, buildEmptyVfs, type VirtualFileSystem } from '../core/vfs.js';
import { EXTENSION_PROBE_ORDER } from '../core/extension-probe-order.js';
import { createConsoleLogger } from '../core/logger.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BINARY_EXTENSIONS = new Set(['.wasm', '.dat', '.pdb']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toPosixPath(p: string): string {
  return sep === '\\' ? p.replace(/\\/g, '/') : p;
}

function stripLeadingSlashOrDot(p: string): string {
  return p.replace(/^\.\//u, '').replace(/^\//u, '');
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

export const dotnetStaticAssets = createUnplugin((options: DotnetAssetsOptions) => {

  // pre-init for safe resolveId before buildStart
  let vfs: VirtualFileSystem = buildEmptyVfs(); 
  let endpointLookup: EndpointLookup = EMPTY_ENDPOINT_LOOKUP;

  const logLevel = options.logLevel ?? 'warn';
  const logger = createConsoleLogger(logLevel);

  return {
    name: 'unplugin-dotnet-static-assets',
    enforce: 'pre' as const,

    async buildStart() {
      const { runtimeManifestPath, endpointsManifestPath } = discoverManifests(
        'manifestPath' in options
          ? { projectName: options.projectName, manifestPath: options.manifestPath }
          : {
              projectRoot: options.projectRoot,
              projectName: options.projectName,
              ...(options.configuration !== undefined && { configuration: options.configuration }),
              ...(options.targetFramework !== undefined && { targetFramework: options.targetFramework }),
              ...(options.isPublish !== undefined && { isPublish: options.isPublish }),
            },
      );

      endpointLookup = buildEndpointLookup(parseEndpointsManifest(readFileSync(endpointsManifestPath)));
      vfs = runtimeManifestPath
        ? buildVfs(parseRuntimeManifest(readFileSync(runtimeManifestPath)), { logger })
        : buildEmptyVfs(endpointsManifestPath, { logger });
    },

    resolveId(source: string) {
      const virtualPath = stripLeadingSlashOrDot(toPosixPath(source));
      if (virtualPath === '') return null;

      const pathProbes: string[] = hasExtension(virtualPath)
        ? [virtualPath]
        : [virtualPath, ...EXTENSION_PROBE_ORDER.map(ext => `${virtualPath}${ext}`)];

      for (const pathProbe of pathProbes) {
        const vfsHit = vfs.resolve(pathProbe);
        if (vfsHit !== undefined) return vfsHit.physicalPath;

        const alias = endpointLookup.get(pathProbe);
        if (alias !== undefined) {
          const resolved = vfs.resolve(alias.assetFile);
          if (resolved !== undefined) return resolved.physicalPath;
          
          const fsHit = vfs.resolveFile(alias.assetFile);
          if (fsHit !== undefined) return fsHit.physicalPath;
        }
      }

      return null;
    },

    load(id: string) {
      const lastDot = id.lastIndexOf('.');
      if (lastDot === -1) return null;
      const ext = id.slice(lastDot);
      if (!BINARY_EXTENSIONS.has(ext)) return null;

      const source = readFileSync(id);
      const refId = this.emitFile({
        type: 'asset',
        name: basename(id),
        source,
      });
      return `export default import.meta.ROLLUP_FILE_URL_${refId};`;
    },
  };
});
