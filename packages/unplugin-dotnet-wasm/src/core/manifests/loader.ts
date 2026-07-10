import { readFile } from 'node:fs/promises';
import type { DotnetAssetsOptions } from '../../types.js';
import { discoverManifests } from './discover.js';
import { parseRuntimeManifest } from './manifest-runtime.js';
import { parseEndpointsManifest } from './manifest-endpoints.js';
import { buildEndpointLookup } from '../endpoint-lookup.js';
import { buildVfs, buildEmptyVfs } from '../vfs.js';
import type { Logger } from '../logger.js';

export interface ManifestLoaderResult {
  endpointLookup: ReturnType<typeof buildEndpointLookup>;
  vfs: ReturnType<typeof buildVfs> | ReturnType<typeof buildEmptyVfs>;
}

export class ManifestLoader {
  constructor(private logger: Logger) {}

  async load(options: DotnetAssetsOptions): Promise<ManifestLoaderResult> {
    const { runtimeManifestPath, endpointsManifestPath } = discoverManifests(options);
    const [endpointsRaw, runtimeRaw] = await Promise.all([
      readFile(endpointsManifestPath),
      runtimeManifestPath ? readFile(runtimeManifestPath) : Promise.resolve(null),
    ]);
    const endpointLookup = buildEndpointLookup(parseEndpointsManifest(endpointsRaw));
    const vfs = runtimeRaw
      ? buildVfs(parseRuntimeManifest(runtimeRaw), { logger: this.logger })
      : buildEmptyVfs(endpointsManifestPath, { logger: this.logger });

    return { endpointLookup, vfs };
  }
}
