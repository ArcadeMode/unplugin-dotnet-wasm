import type { FixtureParameters } from '@dotnet-wasm-bundler/fixture-builder';

/** Runner shard filter (set by scripts/run.mjs from `--bundler` / `--platform`). */
export function envFilter(): Partial<FixtureParameters> {
  const filter: Partial<FixtureParameters> = {};
  if (process.env.FIXTURE_BUNDLER) {
    filter.bundler = process.env.FIXTURE_BUNDLER as FixtureParameters['bundler'];
  }
  if (process.env.FIXTURE_PLATFORM) {
    filter.platform = process.env.FIXTURE_PLATFORM as FixtureParameters['platform'];
  }
  return filter;
}
