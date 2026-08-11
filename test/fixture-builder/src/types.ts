export type Bundler =
  'vite' | 'rollup' | 'rolldown' | 'webpack' | 'rspack' | 'rsbuild' | 'esbuild' | 'farm' | 'bun';
export type Platform = 'browser' | 'node';
export type ServeMode = 'dist' | 'server' | 'watch';
export type BuildMode = 'debug' | 'publish';

export type FixtureProjectName = 'WasmLibrary' | 'BlazorLibrary';

export interface FixtureParameters {
  bundler: Bundler;
  platform: Platform;
  serveMode: ServeMode;
  blazor: boolean;
}

export interface BuildFixtureOptions {
  bundler: Bundler;
  platform: Platform;
  serveMode: ServeMode;
  blazor?: boolean;
  buildMode?: BuildMode;
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

export function projectNameFor(blazor: boolean): FixtureProjectName {
  return blazor ? 'BlazorLibrary' : 'WasmLibrary';
}
