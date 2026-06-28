export type DotnetAssetsMode = 'auto' | 'manifest' | 'consolidated';

export interface DotnetAssetsOptions {
  /**
   * Operating mode.
   *   'manifest'     — Mode A: read {Project}.staticwebassets.runtime.json and build a VFS.
   *   'consolidated' — Mode B: treat `publishDir` as a flat directory.
   *   'auto'         — detect from the filesystem (default).
   */
  mode?: DotnetAssetsMode;

  /**
   * Absolute or workspace-relative path to the .NET project directory (the one
   * containing the .csproj). Used as the root for manifest discovery.
   */
  projectRoot: string;

  /** The .NET project name — used to construct manifest filenames. */
  projectName: string;

  /**
   * MSBuild configuration to look under (`bin/<Configuration>/...`).
   * Default: 'Debug'. The full env-var / bundler-mode resolution chain lands in M2.4.
   */
  configuration?: string;

  /**
   * Target framework moniker (`bin/<Configuration>/<TargetFramework>/...`).
   * Auto-detected when exactly one TFM directory exists; required otherwise.
   */
  targetFramework?: string;

  /**
   * Absolute or workspace-relative path to `{Project}.staticwebassets.runtime.json`.
   * When set, bypasses all discovery — `configuration`, `targetFramework`, and
   * `projectName` are ignored for path construction but `projectName` is still
   * used to find the sibling endpoints manifest when `projectName` is set.
   */
  manifestPath?: string;

  /**
   * Path to the consolidated assets directory produced by `dotnet publish -o <dir>`
   * (Mode B). Omit to auto-discover.
   */
  publishDir?: string;

  /** Verbosity. Default: 'warn'. */
  logLevel?: 'silent' | 'error' | 'warn' | 'info' | 'debug';
}
