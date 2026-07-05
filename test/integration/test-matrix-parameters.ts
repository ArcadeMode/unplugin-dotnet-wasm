export type FixtureShape = 'fingerprint' | 'nofingerprint' | 'none';
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

const VALID_SHAPES: readonly FixtureShape[] = ['fingerprint', 'nofingerprint', 'none'];
const VALID_PLATFORMS: readonly Platform[] = ['browser', 'node'];
const VALID_BUNDLERS: readonly Bundler[] = [
  'vite', 'rollup', 'rolldown', 'webpack', 'rspack', 'rsbuild', 'esbuild', 'farm', 'bun',
];

export function throwErr(msg: string): never {
  throw new Error(msg);
}

export function readShape(): FixtureShape {
  const raw = process.env.DOTNET_FIXTURE_SHAPE ?? throwErr('DOTNET_FIXTURE_SHAPE environment variable is missing');
  if (!VALID_SHAPES.includes(raw as FixtureShape)) {
    throw new Error(`DOTNET_FIXTURE_SHAPE='${raw}' is not one of: ${VALID_SHAPES.join(', ')}.`);
  }
  return raw as FixtureShape;
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
