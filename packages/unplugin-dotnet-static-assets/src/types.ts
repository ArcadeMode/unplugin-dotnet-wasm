/**
 * Plugin options. The shape is a **discriminated union** of two mutually
 * exclusive variants:
 *
 * - {@link DotnetAssetsDiscoveryOptions} (detailed) — the plugin walks
 *   `<projectRoot>/bin/<Configuration>/<TargetFramework>[/publish]/` to locate
 *   the manifests. The `[/publish]` segment is appended when `isPublish` is `true`.
 * - {@link DotnetAssetsExplicitOptions} — the caller supplies the manifest path
 *   directly. Use this when the layout doesn't match `bin/<cfg>/<tfm>/` or when
 *   you've copied the publish output somewhere custom.
 *
 * Both variants work for `dotnet build` and `dotnet publish` outputs. The
 * detailed variant covers the conventional layouts; the explicit variant
 * covers everything else.
 */
export type DotnetAssetsOptions =
  & DotnetAssetsBaseOptions
  & (DotnetAssetsDiscoveryOptions | DotnetAssetsExplicitOptions);

export interface DotnetAssetsBaseOptions {
  /** The .NET project name — used to construct manifest filenames. */
  projectName: string;

  /** Verbosity. Default: `'warn'`. */
  logLevel?: 'silent' | 'error' | 'warn' | 'info' | 'debug';
}

/**
 * Detailed (discovery) shape. The plugin builds the manifest directory from
 * the supplied axes:
 *
 *   `<projectRoot>/bin/<configuration ?? 'Debug'>/<targetFramework>[/publish]/`
 *
 * It then looks for `{projectName}.staticwebassets.runtime.json` and
 * `{projectName}.staticwebassets.endpoints.json` inside it. The runtime
 * manifest may be absent (typical for `dotnet publish` outputs); the endpoints
 * manifest is required.
 */
export interface DotnetAssetsDiscoveryOptions {
  /**
   * Absolute or workspace-relative path to the .NET project directory (the one
   * containing the .csproj).
   */
  projectRoot: string;

  /**
   * MSBuild configuration to look under (`bin/<Configuration>/...`).
   * Default: `'Debug'`.
   */
  configuration?: string;

  /**
   * Target framework moniker (`bin/<Configuration>/<TargetFramework>/...`).
   */
  targetFramework?: string;

  /**
   * Append a `publish/` segment to the manifest directory, matching the
   * `dotnet publish -c <Configuration>` default output layout:
   * `<projectRoot>/bin/<Configuration>/<TargetFramework>/publish/`.
   *
   * Default: `false` (the `dotnet build` layout).
   */
  isPublish?: boolean;
}

/**
 * Explicit-path shape. The caller knows exactly where the manifest directory
 * lives and passes the path to the runtime manifest verbatim. The sibling
 * endpoints manifest is inferred from the same directory using `projectName`.
 *
 * The file at `manifestPath` may or may not exist — for a `dotnet publish`
 * output it typically won't (the publish step doesn't emit the runtime
 * manifest), and the plugin transparently switches to seeding the VFS from
 * the endpoints manifest's `AssetFile` entries.
 */
export interface DotnetAssetsExplicitOptions {
  /**
   * Absolute or workspace-relative path to `{projectName}.staticwebassets.runtime.json`.
   * The file may be absent; the sibling endpoints manifest must exist.
   */
  manifestPath: string;
}
