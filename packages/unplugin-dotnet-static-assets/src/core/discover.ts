import { readdirSync, existsSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DiscoverOptions {
  /**
   * Absolute or workspace-relative path to the .NET project directory
   * (the one containing the .csproj). Required unless `manifestPath` is set.
   */
  projectRoot: string;

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
   * Bypass all path-construction logic and use this path verbatim.
   * When set, all other options except `projectRoot` are ignored.
   */
  manifestPath?: string;
}

export interface DiscoverResult {
  /** Absolute path to `{Project}.staticwebassets.runtime.json`. */
  manifestPath: string;
  /** Project name derived from the manifest filename (without the `.staticwebassets.runtime.json` suffix). */
  projectName: string;
  /** The configuration that was resolved/used. */
  resolvedConfiguration: string;
  /** The TFM that was resolved/used. */
  resolvedTargetFramework: string;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Locate `{Project}.staticwebassets.runtime.json` for a .NET WASM project.
 *
 * Throws a {@link DiscoveryError} with a descriptive message when the manifest
 * cannot be found or the path is ambiguous.
 */
export function discoverRuntimeManifest(opts: DiscoverOptions): DiscoverResult {
  const projectRoot = resolve(opts.projectRoot);

  // --- 1. Explicit manifestPath bypass ---
  if (opts.manifestPath) {
    const abs = resolve(opts.manifestPath);
    if (!existsSync(abs)) {
      throw new DiscoveryError(
        `Explicit manifestPath does not exist: ${abs}`,
        { projectRoot },
      );
    }
    return buildResult(abs, 'unknown', 'unknown');
  }

  // --- 2. Resolve configuration ---
  const configuration = opts.configuration ?? 'Debug';

  const configDir = join(projectRoot, 'bin', configuration);
  if (!existsSync(configDir)) {
    throw new DiscoveryError(
      `Configuration directory not found: ${configDir}\n` +
      `  Searched for: bin/${configuration}/\n` +
      `  Hint: run 'dotnet build' first, or set { configuration: '...' } explicitly.`,
      { projectRoot, configuration },
    );
  }

  // --- 3. Resolve target framework ---
  const targetFramework = opts.targetFramework ?? resolveUnique(
    configDir,
    'targetFramework',
    `  Hint: set { targetFramework: 'net10.0' } (or the correct TFM) explicitly.`,
  );

  const tfmDir = join(configDir, targetFramework);
  if (!existsSync(tfmDir)) {
    throw new DiscoveryError(
      `Target framework directory not found: ${tfmDir}`,
      { projectRoot, configuration, targetFramework },
    );
  }

  // --- 4. Glob for *.staticwebassets.runtime.json ---
  const manifests = globManifests(tfmDir);

  if (manifests.length === 0) {
    throw new DiscoveryError(
      `No *.staticwebassets.runtime.json found in: ${tfmDir}\n` +
      `  Resolved axes: configuration=${configuration}, targetFramework=${targetFramework}\n` +
      `  Hint: run 'dotnet build' first.`,
      { projectRoot, configuration, targetFramework },
    );
  }

  if (manifests.length > 1) {
    const names = manifests.map((m) => `  • ${m}`).join('\n');
    throw new DiscoveryError(
      `Multiple *.staticwebassets.runtime.json files found in: ${tfmDir}\n` +
      `${names}\n` +
      `  Hint: set { manifestPath: '...' } to select one explicitly.`,
      { projectRoot, configuration, targetFramework },
    );
  }

  return buildResult(manifests[0]!, configuration, targetFramework);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns absolute paths of all *.staticwebassets.runtime.json in a directory (non-recursive). */
function globManifests(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.staticwebassets.runtime.json'))
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

/**
 * Lists subdirectories of `dir` and returns the name of the single one found.
 * Throws {@link DiscoveryError} when zero or more than one subdirectory exists.
 */
function resolveUnique(dir: string, axis: string, hint: string): string {
  let entries: string[];
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    entries = [];
  }

  if (entries.length === 0) {
    throw new DiscoveryError(
      `No ${axis} directories found under: ${dir}\n${hint}`,
      {},
    );
  }

  if (entries.length > 1) {
    const list = entries.map((e) => `  • ${e}`).join('\n');
    throw new DiscoveryError(
      `Multiple ${axis} directories found under: ${dir}\n${list}\n${hint}`,
      {},
    );
  }

  return entries[0]!;
}

function buildResult(
  manifestPath: string,
  resolvedConfiguration: string,
  resolvedTargetFramework: string,
): DiscoverResult {
  const filename = basename(manifestPath);
  const projectName = filename.replace(/\.staticwebassets\.runtime\.json$/, '');
  return { manifestPath, projectName, resolvedConfiguration, resolvedTargetFramework };
}

// ---------------------------------------------------------------------------
// Endpoints manifest discovery
// ---------------------------------------------------------------------------

/**
 * Derive the absolute path of `{Project}.staticwebassets.endpoints.json` that
 * sits alongside the runtime manifest returned by {@link discoverRuntimeManifest}.
 *
 * Returns `null` when the file does not exist — the endpoints manifest is
 * **optional**.  Callers should treat `null` as "fingerprint-aware resolution
 * not available; resolve from the VFS alone".  The runtime manifest remains
 * required regardless.
 */
export function discoverEndpointsManifest(result: DiscoverResult): string | null {
  const endpointsPath = result.manifestPath.replace(
    /\.staticwebassets\.runtime\.json$/,
    '.staticwebassets.endpoints.json',
  );
  return existsSync(endpointsPath) ? endpointsPath : null;
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
