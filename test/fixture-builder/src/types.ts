/** Supported bundlers (full catalog; Phase 1 implements `vite` only). */
export type Bundler =
  'vite' | 'rollup' | 'rolldown' | 'webpack' | 'rspack' | 'rsbuild' | 'esbuild' | 'farm' | 'bun';

export type Platform = 'browser' | 'node';

/**
 * How the fixture is served/run:
 * - `dist`   — one-shot build, static-serve output (boot check).
 * - `server` — dev server (HMR/websocket). Runs the change test.
 * - `watch`  — bundler `--watch` output, statically served / one-shot `node dist/entry.js`.
 */
export type ServeMode = 'dist' | 'server' | 'watch';

/** `debug` → `dotnet build -c Debug`; `publish` → `dotnet publish -c Release`. */
export type BuildMode = 'debug' | 'publish';

/** The three orthogonal dimensions that identify a fixture instance. */
export interface FixtureParameters {
  bundler: Bundler;
  platform: Platform;
  serveMode: ServeMode;
}

export interface BuildFixtureOptions {
  bundler: Bundler;
  platform: Platform;
  serveMode: ServeMode;
  /** Default `debug`. */
  buildMode?: BuildMode;
  /** Default `true` (SDK default). Maps to `-p:WasmFingerprintAssets`. */
  fingerprint?: boolean;
  /** Explicit port; default an ephemeral free port. */
  port?: number;
  /** Keep the materialized dir after `dispose()`. Default `false`. */
  keepOnDispose?: boolean;
}

/** Result of a completed (non-long-running) process. */
export interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** Interleaved stdout+stderr in emission order. */
  output: string;
}

export interface WaitForLogOptions {
  /** Milliseconds before rejecting. Default 5_000. */
  timeout?: number;
}
