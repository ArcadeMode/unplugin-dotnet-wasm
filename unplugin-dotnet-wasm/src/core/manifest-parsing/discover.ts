import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

export type DiscoverOptions = DiscoverByProjectOptions | DiscoverByPathOptions;

interface DiscoverByProjectOptions {
  /** The .NET project name — used to construct manifest filenames. */
  projectName: string;
  /** Absolute or workspace-relative path to the directory containing the .csproj. */
  projectRoot: string;
  /** MSBuild configuration. */
  configuration: 'Debug' | 'Release' | (string & {});
  /** Target framework moniker (e.g. `'net10.0'`). */
  targetFramework: string;
  /** Append a `publish/` segment, matching `dotnet publish` output layout. Default: `false`. */
  isPublish?: boolean;
}

interface DiscoverByPathOptions {
  /** The .NET project name — used to construct manifest filenames. */
  projectName: string;
  /** Absolute or workspace-relative path to the .NET build/publish output directory containing the static-web-assets manifests. */
  dotnetOutputDir: string;
}

export interface Manifests {
  /** Absolute path to the runtime manifest, or `null` when absent (publish output). */
  runtimeManifestPath: string | null;
  /** Absolute path to the endpoints manifest. */
  endpointsManifestPath: string;
}

/**
 * Locate the runtime and endpoints manifests for a .NET static-web-assets project.
 * Throws {@link DiscoveryError} when the endpoints manifest is missing.
 */
export function discoverManifests(opts: DiscoverOptions): Manifests {
  const manifestDir = 'dotnetOutputDir' in opts
    ? resolve(opts.dotnetOutputDir)
    : join(
        resolve(opts.projectRoot),
        'bin',
        opts.configuration,
        opts.targetFramework,
        opts.isPublish ? 'publish' : '',
      );

  const runtimeManifestPath = join(manifestDir, `${opts.projectName}.staticwebassets.runtime.json`);
  const endpointsManifestPath = join(manifestDir, `${opts.projectName}.staticwebassets.endpoints.json`);

  if (!existsSync(endpointsManifestPath)) {
    const context: DiscoveryContext = 'projectRoot' in opts
      ? {
          projectRoot: opts.projectRoot,
          configuration: opts.configuration,
          targetFramework: opts.targetFramework,
        }
      : {};
    throw new DiscoveryError(`Endpoints manifest not found at ${manifestDir}`, context);
  }

  return {
    runtimeManifestPath: existsSync(runtimeManifestPath) ? runtimeManifestPath : null,
    endpointsManifestPath,
  };
}

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
