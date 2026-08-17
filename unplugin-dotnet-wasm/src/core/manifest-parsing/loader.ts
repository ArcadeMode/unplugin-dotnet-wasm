import { readFile, stat } from 'node:fs/promises';
import type { DotnetWasmOptions } from '../../types';
import { discoverManifests } from './discover';
import { parseRuntimeManifest, type RuntimeManifest } from './manifest-runtime';
import { parseEndpointsManifest, type EndpointsManifest } from './manifest-endpoints';

export interface ManifestLoaderResult {
  endpointsManifest: EndpointsManifest;
  runtimeManifest: RuntimeManifest | null;
  endpointsManifestPath: string;
  /** True only when every file (including runtime still absent) was a cache hit. */
  fromCache: boolean;
}

interface Fingerprint {
  path: string;
  mtimeMs: number;
  size: number;
}

interface CachedManifest<T> {
  fingerprint: Fingerprint;
  parsed: T;
}

interface LoadedFile<T> {
  parsed: T;
  fromCache: boolean;
  cached: CachedManifest<T> | null;
}

async function fingerprintOf(path: string): Promise<Fingerprint> {
  const s = await stat(path);
  return { path, mtimeMs: s.mtimeMs, size: s.size };
}

function sameFingerprint(a: Fingerprint, b: Fingerprint): boolean {
  return a.path === b.path && a.mtimeMs === b.mtimeMs && a.size === b.size;
}

export class ManifestLoader {
  #endpoints: CachedManifest<EndpointsManifest> | null = null;
  #runtime: CachedManifest<RuntimeManifest> | null = null;
  #runtimeWasAbsent = false;
  #hasLoaded = false;

  async load(options: DotnetWasmOptions): Promise<ManifestLoaderResult> {
    const { runtimeManifestPath, endpointsManifestPath } = discoverManifests(options);

    const [endpoints, runtime] = await Promise.all([
      this.#loadFile(endpointsManifestPath, this.#endpoints, parseEndpointsManifest),
      runtimeManifestPath
        ? this.#loadFile(runtimeManifestPath, this.#runtime, parseRuntimeManifest)
        : Promise.resolve({
            parsed: null,
            fromCache: this.#hasLoaded && this.#runtimeWasAbsent,
            cached: null,
          }),
    ]);

    this.#endpoints = endpoints.cached;
    if (runtimeManifestPath) {
      this.#runtime = runtime.cached;
      this.#runtimeWasAbsent = false;
    } else {
      this.#runtime = null;
      this.#runtimeWasAbsent = true;
    }
    this.#hasLoaded = true;

    return {
      endpointsManifest: endpoints.parsed,
      runtimeManifest: runtime.parsed,
      endpointsManifestPath,
      fromCache: endpoints.fromCache && runtime.fromCache,
    };
  }

  async #loadFile<T>(
    path: string,
    cached: CachedManifest<T> | null,
    parse: (raw: Buffer) => T,
  ): Promise<LoadedFile<T>> {
    const first = await fingerprintOf(path);
    if (cached && sameFingerprint(cached.fingerprint, first)) {
      return { parsed: cached.parsed, fromCache: true, cached };
    }

    const parsed = parse(await readFile(path));
    const second = await fingerprintOf(path);
    // File changed between stat and read: serve this parse but do not cache a torn write.
    if (!sameFingerprint(first, second)) {
      return { parsed, fromCache: false, cached: null };
    }

    return { parsed, fromCache: false, cached: { fingerprint: second, parsed } };
  }
}
