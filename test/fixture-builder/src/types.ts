export type Bundler =
  'vite' | 'rollup' | 'rolldown' | 'webpack' | 'rspack' | 'rsbuild' | 'esbuild' | 'farm' | 'bun';
export type Platform = 'browser' | 'node';
export type ServeMode = 'dist' | 'server' | 'watch';
export type BuildMode = 'debug' | 'publish';
export type FixtureKind = 'wasm' | 'blazor';

export type FixtureProjectName = 'WasmLibrary' | 'BlazorLibrary';

export interface FixtureParameters {
  bundler: Bundler;
  platform: Platform;
  serveMode: ServeMode;
  kind: FixtureKind;
  buildMode: BuildMode;
}

export interface BuildFixtureOptions extends FixtureParameters {
  port?: number;
  keepOnDispose?: boolean;
}

export interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  output: string;
}

export interface WaitForLogOptions {
  timeout?: number;
}

export function projectNameFor(kind: FixtureKind): FixtureProjectName {
  return kind === 'blazor' ? 'BlazorLibrary' : 'WasmLibrary';
}
