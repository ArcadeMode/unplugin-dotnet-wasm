import { existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DiscoverOptions {
  /**
   * Absolute or workspace-relative path to the .NET project directory
   * (the one containing the .csproj). Required unless `manifestPath` is set.
   */
  projectRoot?: string;

  /** The .NET project name — used to construct manifest filenames. */
  projectName: string;

  /**
   * MSBuild configuration — e.g. `'Debug'` or `'Release'`.
   * Defaults to `'Debug'` in M1; full env/bundler-mode resolution lands in M2.4.
   */
  configuration?: string;

  /**
   * Target framework moniker — e.g. `'net10.0'`.
   * Auto-detected when exactly one TFM directory exists under
   * `bin/<configuration>/`; required (with a clear error) when multiple exist.
   */
  targetFramework?: string;

  /**
   * Append a `publish` segment to the manifest directory path, producing
   * `<projectRoot>/bin/<configuration>/<targetFramework>/publish/`.
   *
   * Use this when pointing at a `dotnet publish` output in the default SDK
   * layout. The runtime manifest is typically absent there; the endpoints
   * manifest is required.
   *
   * Default: `false` (the `dotnet build` layout).
   */
  isPublish?: boolean;

  /**
   * Absolute path to `{Project}.staticwebassets.runtime.json`.
   * When set, bypasses all discovery — `projectRoot`, `configuration`, and
   * `targetFramework` are ignored. The sibling endpoints manifest is inferred
   * from the same directory using `projectName`.
   */
  manifestPath?: string;
}

export interface Manifests {
  /** Absolute path to `{Project}.staticwebassets.runtime.json`, or `null` when absent (Mode B). */
  runtimeManifestPath: string | null;
  /** Absolute path to `{Project}.staticwebassets.endpoints.json` */
  endpointsManifestPath: string;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Locate `{projectName}.staticwebassets.runtime.json` and
 * `{projectName}.staticwebassets.endpoints.json` for a .NET WASM project.
 * 
 * Throws {@link DiscoveryError} only when no endpoints manifest is found.
 */
export function discoverManifests(opts: DiscoverOptions): Manifests {
  // Short-circuit: caller supplied an explicit manifest path.
  if (opts.manifestPath !== undefined) {
    const runtimeManifestPath = resolve(opts.manifestPath);
    const endpointsPath = join(
      dirname(runtimeManifestPath),
      `${opts.projectName}.staticwebassets.endpoints.json`,
    );

    if (!existsSync(endpointsPath)) {
      throw new DiscoveryError(`Endpoints manifest not found at ${opts.manifestPath}`, { });
    }

    return {
      runtimeManifestPath: existsSync(runtimeManifestPath) ? runtimeManifestPath : null,
      endpointsManifestPath: endpointsPath,
    };
  }

  const projectRoot = resolve(opts.projectRoot ?? '');
  const configuration = opts.configuration ?? 'Debug';
  const tfmDir = join(
    projectRoot,
    'bin',
    configuration,
    opts.targetFramework ?? '',
    opts.isPublish ? 'publish' : '',
  );

  const runtimePath = join(tfmDir, `${opts.projectName}.staticwebassets.runtime.json`);
  const endpointsPath = join(tfmDir, `${opts.projectName}.staticwebassets.endpoints.json`);

  if (!existsSync(endpointsPath)) {
    throw new DiscoveryError(`Endpoints manifest not found at ${tfmDir}`,{});
  }

  return {
    runtimeManifestPath: existsSync(runtimePath) ? runtimePath : null,
    endpointsManifestPath: endpointsPath,
  };
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export interface DiscoveryContext {
  projectRoot?: string;
  configuration?: string;
  targetFramework?: string;
}

export class DiscoveryError extends Error {
  readonly context: DiscoveryContext;

  constructor(message: string, context: DiscoveryContext) {
    super(message);
    this.name = 'DiscoveryError';
    this.context = context;
  }
}
