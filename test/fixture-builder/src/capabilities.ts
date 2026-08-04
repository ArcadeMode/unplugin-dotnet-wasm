import { isBundlerImplemented } from './manifest';
import type { Bundler, FixtureParameters, Platform, ServeMode } from './types';

export interface BundlerCapabilities {
  build: boolean;
  publish: boolean;
  watch: boolean;
  devServerBrowser: boolean;
  devServerNode: boolean;
}

export const CAPABILITIES: Record<Bundler, BundlerCapabilities> = {
  vite: { build: true, publish: true, watch: true, devServerBrowser: true, devServerNode: true },
  rollup: {
    build: true,
    publish: true,
    watch: true,
    devServerBrowser: false,
    devServerNode: false,
  },
  rolldown: {
    build: true,
    publish: true,
    watch: true,
    devServerBrowser: false,
    devServerNode: false,
  },
  webpack: {
    build: true,
    publish: true,
    watch: true,
    devServerBrowser: true,
    devServerNode: false,
  },
  rspack: { build: true, publish: true, watch: true, devServerBrowser: true, devServerNode: false },
  rsbuild: {
    build: true,
    publish: true,
    watch: true,
    devServerBrowser: true,
    devServerNode: false,
  },
  esbuild: {
    build: true,
    publish: true,
    watch: true,
    devServerBrowser: false,
    devServerNode: false,
  },
  farm: { build: true, publish: true, watch: true, devServerBrowser: true, devServerNode: false },
  bun: { build: true, publish: true, watch: false, devServerBrowser: false, devServerNode: false },
};

export function supports(bundler: Bundler, platform: Platform, serveMode: ServeMode): boolean {
  if (!isBundlerImplemented(bundler)) return false;
  const caps = CAPABILITIES[bundler];
  switch (serveMode) {
    case 'dist':
      return caps.build;
    case 'watch':
      return caps.watch;
    case 'server':
      return platform === 'node' ? caps.devServerNode : caps.devServerBrowser;
  }
}

const ALL_BUNDLERS = Object.keys(CAPABILITIES) as Bundler[];
const ALL_PLATFORMS: readonly Platform[] = ['browser', 'node'];
const ALL_SERVE_MODES: readonly ServeMode[] = ['dist', 'server', 'watch'];

export function getFixtureParameterPermutations(
  fixed: Partial<FixtureParameters> = {},
): FixtureParameters[] {
  const bundlers = fixed.bundler ? [fixed.bundler] : ALL_BUNDLERS;
  const platforms = fixed.platform ? [fixed.platform] : ALL_PLATFORMS;
  const serveModes = fixed.serveMode ? [fixed.serveMode] : ALL_SERVE_MODES;
  const out: FixtureParameters[] = [];
  for (const bundler of bundlers) {
    for (const platform of platforms) {
      for (const serveMode of serveModes) {
        out.push({ bundler, platform, serveMode });
      }
    }
  }
  return out;
}
