export { buildFixture } from './build-fixture';
export { MATERIALIZED_ROOT } from './materialize';
export { Fixture } from './fixture';
export type { FixtureInit } from './fixture';
export { libraryOutputDir } from './dotnet';
export {
  CAPABILITIES,
  supports,
  getFixtureParameterPermutations,
  type BundlerCapabilities,
} from './capabilities';
export type { WaitForSentinelOptions } from './sentinel';
export type {
  BuildFixtureOptions,
  BuildMode,
  Bundler,
  FixtureKind,
  FixtureParameters,
  FixtureProjectName,
  Platform,
  RunResult,
  ServeMode,
  WaitForLogOptions,
} from './types';
export { projectNameFor } from './types';
