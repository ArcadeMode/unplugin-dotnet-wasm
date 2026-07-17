export type Platform = 'browser' | 'node';
export type Bundler =
  | 'vite'
  | 'rollup'
  | 'rolldown'
  | 'webpack'
  | 'rspack'
  | 'rsbuild'
  | 'esbuild'
  | 'farm'
  | 'bun';
export type Fingerprint = 'fingerprint' | 'nofingerprint';
export type BuildMode = 'debug' | 'publish' | 'none';

const VALID_PLATFORMS: readonly Platform[] = ['browser', 'node'];
const VALID_BUNDLERS: readonly Bundler[] = [
  'vite', 'rollup', 'rolldown', 'webpack', 'rspack', 'rsbuild', 'esbuild', 'farm', 'bun',
];
const VALID_FINGERPRINTS: readonly Fingerprint[] = ['fingerprint', 'nofingerprint'];
const VALID_BUILD_MODES: readonly BuildMode[] = ['debug', 'publish', 'none'];

export function throwErr(msg: string): never {
  throw new Error(msg);
}

export function readFingerprint(): Fingerprint {
  const raw = process.env.DOTNET_FINGERPRINT ?? throwErr('DOTNET_FINGERPRINT environment variable is missing');
  if (!VALID_FINGERPRINTS.includes(raw as Fingerprint)) {
    throw new Error(`DOTNET_FINGERPRINT='${raw}' is not one of: ${VALID_FINGERPRINTS.join(', ')}.`);
  }
  return raw as Fingerprint;
}

export function readBuildMode(): BuildMode {
  const raw = process.env.DOTNET_BUILD_MODE ?? throwErr('DOTNET_BUILD_MODE environment variable is missing');
  if (!VALID_BUILD_MODES.includes(raw as BuildMode)) {
    throw new Error(`DOTNET_BUILD_MODE='${raw}' is not one of: ${VALID_BUILD_MODES.join(', ')}.`);
  }
  return raw as BuildMode;
}

export function readPlatform(): Platform {
  const raw = process.env.PLATFORM ?? throwErr('PLATFORM environment variable is missing');
  if (!VALID_PLATFORMS.includes(raw as Platform)) {
    throw new Error(`PLATFORM='${raw}' is not one of: ${VALID_PLATFORMS.join(', ')}.`);
  }
  return raw as Platform;
}

export function readBundler(): Bundler {
  const raw = process.env.BUNDLER ?? throwErr('BUNDLER environment variable is missing');
  if (!VALID_BUNDLERS.includes(raw as Bundler)) {
    throw new Error(`BUNDLER='${raw}' is not implemented yet. Supported: ${VALID_BUNDLERS.join(', ')}.`);
  }
  return raw as Bundler;
}

export type ServeMode = 'dist' | 'server';
const VALID_SERVE_MODES: readonly ServeMode[] = ['dist', 'server'];
export function readServeMode(): ServeMode {
  const raw = (process.env.SERVE_MODE ?? 'dist') as ServeMode;
  if (!VALID_SERVE_MODES.includes(raw)) {
    throw new Error(`SERVE_MODE='${raw}' is not one of: ${VALID_SERVE_MODES.join(', ')}.`);
  }
  return raw;
}
