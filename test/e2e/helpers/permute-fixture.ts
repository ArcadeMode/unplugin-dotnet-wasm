import { test } from '@playwright/test';
import {
  getFixtureParameterPermutations,
  supports,
  type FixtureParameters,
} from '@dotnet-wasm-bundler/fixture-builder';

/** Runner shard filter (set by scripts/run.mjs from `--bundler` / `--platform`). */
function envFilter(): Partial<FixtureParameters> {
  const filter: Partial<FixtureParameters> = {};
  if (process.env.FIXTURE_BUNDLER) {
    filter.bundler = process.env.FIXTURE_BUNDLER as FixtureParameters['bundler'];
  }
  if (process.env.FIXTURE_PLATFORM) {
    filter.platform = process.env.FIXTURE_PLATFORM as FixtureParameters['platform'];
  }
  return filter;
}

/**
 * Emit one `describe` per fixture parameter combination matching `filter`,
 * keeping the enumeration + capability gating out of spec files. Supported
 * combinations run; unsupported ones (unimplemented bundler or unsupported
 * mode) become visible skips. The runner's shard filter is merged in via env.
 */
export function permuteFixture(
  filter: Partial<FixtureParameters>,
  body: (params: FixtureParameters) => void,
): void {
  const merged = { ...filter, ...envFilter() };
  for (const params of getFixtureParameterPermutations(merged)) {
    const label = `[${params.bundler}][${params.platform}][${params.serveMode}]`;
    const runnable = supports(params.bundler, params.platform, params.serveMode);
    (runnable ? test.describe : test.describe.skip)(label, () => body(params));
  }
}
