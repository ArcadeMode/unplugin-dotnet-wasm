import { readFile } from 'node:fs/promises';
import type { DotnetAssetsOptions } from '../../types.js';
import { discoverManifests } from './discover.js';
import { parseRuntimeManifest, type RuntimeManifest } from './manifest-runtime.js';
import { parseEndpointsManifest, type EndpointsManifest } from './manifest-endpoints.js';

export interface ManifestLoaderResult {
  endpointsManifest: EndpointsManifest;
  runtimeManifest: RuntimeManifest | null;
  endpointsManifestPath: string;
}

export class ManifestLoader {
  async load(options: DotnetAssetsOptions): Promise<ManifestLoaderResult> {
    const { runtimeManifestPath, endpointsManifestPath } = discoverManifests(options);
    const [endpointsRaw, runtimeRaw] = await Promise.all([
      readFile(endpointsManifestPath),
      runtimeManifestPath ? readFile(runtimeManifestPath) : Promise.resolve(null),
    ]);
    const endpointsManifest = parseEndpointsManifest(endpointsRaw);
    const runtimeManifest = runtimeRaw ? parseRuntimeManifest(runtimeRaw) : null;

    return { endpointsManifest, runtimeManifest, endpointsManifestPath };
  }
}
