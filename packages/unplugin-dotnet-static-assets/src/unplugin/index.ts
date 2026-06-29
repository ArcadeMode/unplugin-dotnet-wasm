import { createUnplugin } from 'unplugin';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { DotnetAssetsOptions } from '../types.js';
import { discoverManifests } from '../core/discover.js';
import { parseRuntimeManifest } from '../core/manifest-runtime.js';
import { parseEndpointsManifest } from '../core/manifest-endpoints.js';
import { buildEndpointLookup } from '../core/endpoint-lookup.js';
import { buildVfs, buildEmptyVfs } from '../core/vfs.js';
import { createConsoleLogger } from '../core/logger.js';
import { AssetResolver } from '../core/asset-resolver.js';

const BINARY_EXTENSIONS = new Set(['.wasm', '.dat', '.pdb']);

export const dotnetStaticAssets = createUnplugin((options: DotnetAssetsOptions) => {
  let assetResolver: AssetResolver | null = null;

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
      
      const logLevel = options.logLevel ?? 'warn';
      const logger = createConsoleLogger(logLevel);
      const endpointLookup = buildEndpointLookup(parseEndpointsManifest(readFileSync(endpointsManifestPath)));
      const vfs = runtimeManifestPath
        ? buildVfs(parseRuntimeManifest(readFileSync(runtimeManifestPath)), { logger })
        : buildEmptyVfs(endpointsManifestPath, { logger });

      assetResolver = new AssetResolver(vfs, endpointLookup);
    },

    resolveId(source: string) {
      if (!assetResolver) return null;
      return assetResolver.resolve(source);
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
