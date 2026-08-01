import { isBundlerImplemented } from './manifest';
import type { Bundler, FixtureParameters, Platform, ServeMode } from './types';

/**
 * What each bundler's plugin integration supports
 */
export interface BundlerCapabilities {
  /** `dist` (browser bundle / node artifact). */
  build: boolean;
  /** `dotnet publish -c Release` variant builds + boots. */
  publish: boolean;
  /** `--watch` output (statically served in browser / one-shot `node`). */
  watch: boolean;
  /** Dev server with HMR/websocket reload, browser platform. */
  devServerBrowser: boolean;
  /** Dev server (SSR), node platform. */
  devServerNode: boolean;
}

// Derived from the retired matrix lists:
//   DEV_SERVER_BUNDLERS      = vite, webpack, rspack, rsbuild, farm
//   DEV_SERVER_NODE_BUNDLERS = vite
// build/publish/watch are universal end-state; refine as each mode is validated.
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
    watch: false,
    devServerBrowser: false,
    devServerNode: false,
  },
  farm: { build: true, publish: true, watch: true, devServerBrowser: true, devServerNode: false },
  bun: { build: true, publish: true, watch: false, devServerBrowser: false, devServerNode: false },
};

/**
 * Can the harness run this bundler + platform + serve mode
 */
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

/**
 * Full cartesian product of FixtureParameters, keeping provided dimensions fixed.
 */
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
