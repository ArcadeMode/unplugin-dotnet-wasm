import type { Bundler, Platform } from '../test-matrix';
import type { IsolatedBundlerBuild } from './isolated-bundler-build';
import { IsolatedViteBuild } from './isolated-vite-build';
import { IsolatedRollupBuild } from './isolated-rollup-build';
import { IsolatedRolldownBuild } from './isolated-rolldown-build';
import { IsolatedWebpackBuild } from './isolated-webpack-build';
import { IsolatedRspackBuild } from './isolated-rspack-build';
import { IsolatedRsbuildBuild } from './isolated-rsbuild-build';
import { IsolatedEsbuildBuild } from './isolated-esbuild-build';
import { IsolatedFarmBuild } from './isolated-farm-build';
import { IsolatedBunBuild } from './isolated-bun-build';

export function createIsolatedBuild(
  bundler: Bundler,
  fixtureDir: string,
  platform: Platform,
  label: string,
): IsolatedBundlerBuild {
  switch (bundler) {
    case 'vite':
      return new IsolatedViteBuild(fixtureDir, platform, label);
    case 'rollup':
      return new IsolatedRollupBuild(fixtureDir, platform, label);
    case 'rolldown':
      return new IsolatedRolldownBuild(fixtureDir, platform, label);
    case 'webpack':
      return new IsolatedWebpackBuild(fixtureDir, platform, label);
    case 'rspack':
      return new IsolatedRspackBuild(fixtureDir, platform, label);
    case 'rsbuild':
      return new IsolatedRsbuildBuild(fixtureDir, platform, label);
    case 'esbuild':
      return new IsolatedEsbuildBuild(fixtureDir, platform, label);
    case 'farm':
      return new IsolatedFarmBuild(fixtureDir, platform, label);
    case 'bun':
      return new IsolatedBunBuild(fixtureDir, platform, label);
  }
}
