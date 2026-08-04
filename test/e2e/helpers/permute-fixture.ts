import { test } from '@playwright/test';
import {
  getFixtureParameterPermutations,
  supports,
  type FixtureParameters,
} from '@dotnet-wasm-bundler/fixture-builder';
import { envFilter } from './envFilter';

/**
 * Emit one `describe` per fixture parameter permutation (preserving `fixed` dimensions)
 */
export function permuteFixture(
  fixed: Partial<FixtureParameters>,
  body: (params: FixtureParameters) => void,
): void {
  const merged = { ...fixed, ...envFilter() };
  for (const params of getFixtureParameterPermutations(merged)) {
    const label = `[${params.bundler}][${params.platform}][${params.serveMode}]`;
    const runnable = supports(params.bundler, params.platform, params.serveMode);
    (runnable ? test.describe : test.describe.skip)(label, () => body(params));
  }
}
