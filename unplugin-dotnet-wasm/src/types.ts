/**
 * Plugin options. Discriminated union: pass either project-discovery axes
 * ({@link DotnetAssetsDiscoveryOptions}) or an explicit `dotnetOutputDir`
 * ({@link DotnetAssetsExplicitOptions}).
 */
export type DotnetAssetsOptions = DotnetAssetsBaseOptions &
  (DotnetAssetsDiscoveryOptions | DotnetAssetsExplicitOptions);

export interface DotnetAssetsBaseOptions {
  /** The .NET project name - used to construct manifest filenames. */
  projectName: string;
  /** Verbosity. Default: `'warn'`. */
  logLevel?: 'silent' | 'error' | 'warn' | 'info' | 'debug';
}

/** Locate manifests under `<projectRoot>/bin/<configuration>/<targetFramework>[/publish]/`. */
export interface DotnetAssetsDiscoveryOptions {
  /** Absolute or workspace-relative path to the directory containing the .csproj. */
  projectRoot: string;
  /** MSBuild configuration. */
  configuration: 'Debug' | 'Release' | (string & {});
  /** Target framework moniker (e.g. `'net10.0'`). */
  targetFramework: 'net10.0' | (string & {});
  /** Use `dotnet publish` output layout (appends `publish/`). Default: `false`. */
  isPublish?: boolean;
}

/** Point directly at the .NET build/publish output directory containing the static-web-assets manifests. */
export interface DotnetAssetsExplicitOptions {
  /** Absolute or workspace-relative path to the .NET build/publish output directory. */
  dotnetOutputDir: string;
}
