import type { Bundler, Platform } from '../test-matrix.js';
import { IsolatedBundlerBuild } from './isolated-bundler-build.js';
import { IsolatedViteBuild } from './isolated-vite-build.js';
import { IsolatedRollupBuild } from './isolated-rollup-build.js';
import { IsolatedRolldownBuild } from './isolated-rolldown-build.js';
import { IsolatedWebpackBuild } from './isolated-webpack-build.js';
import { IsolatedRspackBuild } from './isolated-rspack-build.js';
import { IsolatedRsbuildBuild } from './isolated-rsbuild-build.js';
import { IsolatedEsbuildBuild } from './isolated-esbuild-build.js';
import { IsolatedFarmBuild } from './isolated-farm-build.js';
import { IsolatedBunBuild } from './isolated-bun-build.js';

export function createIsolatedBuild(bundler: Bundler, fixtureDir: string, platform: Platform, label: string): IsolatedBundlerBuild {
  switch (bundler) {
    case 'vite':     return new IsolatedViteBuild(fixtureDir, platform, label);
    case 'rollup':   return new IsolatedRollupBuild(fixtureDir, platform, label);
    case 'rolldown': return new IsolatedRolldownBuild(fixtureDir, platform, label);
    case 'webpack':  return new IsolatedWebpackBuild(fixtureDir, platform, label);
    case 'rspack':   return new IsolatedRspackBuild(fixtureDir, platform, label);
    case 'rsbuild':  return new IsolatedRsbuildBuild(fixtureDir, platform, label);
    case 'esbuild':  return new IsolatedEsbuildBuild(fixtureDir, platform, label);
    case 'farm':     return new IsolatedFarmBuild(fixtureDir, platform, label);
    case 'bun':      return new IsolatedBunBuild(fixtureDir, platform, label);
  }
}
