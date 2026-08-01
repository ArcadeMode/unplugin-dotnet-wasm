import type { BuildMode, Bundler, Platform, ServeMode } from './types';

export interface ScriptContext {
  platform: Platform;
  serveMode: ServeMode;
  buildMode: BuildMode;
  port: number;
}

export interface BundlerManifest {
  /**
   * Config files copied verbatim from `templates/bundlers/<id>/` into the
   * materialized project root.
   */
  configFiles: string[];
  /** Build the generated `package.json` `scripts` block for one instance. */
  scripts(ctx: ScriptContext): Record<string, string>;
}

/** Vite mode flag derived from the build mode. */
function viteMode(buildMode: BuildMode): 'development' | 'production' {
  return buildMode === 'publish' ? 'production' : 'development';
}

const vite: BundlerManifest = {
  configFiles: ['vite.config.ts'],
  scripts({ port, buildMode }) {
    const mode = viteMode(buildMode);
    return {
      // One-shot build → `dist/` (dist + watch serve modes).
      build: `vite build --mode ${mode}`,
      // Rebuild-on-change (watch serve mode).
      watch: `vite build --watch --mode ${mode}`,
      // Dev server (server serve mode) on the allocated port.
      dev: `vite --port ${port} --strictPort --mode ${mode}`,
    };
  },
};

const webpack: BundlerManifest = {
  configFiles: ['webpack.config.mjs'],
  scripts({ port, buildMode }) {
    const mode = buildMode === 'publish' ? 'production' : 'development';
    const config = '--config webpack.config.mjs';
    return {
      // One-shot build → `dist/` (dist + watch serve modes).
      build: `webpack ${config} --mode ${mode}`,
      // Rebuild-on-change (watch serve mode).
      watch: `webpack ${config} --watch --mode ${mode}`,
      // Dev server (server serve mode) on the allocated port.
      dev: `webpack serve ${config} --port ${port} --mode ${mode}`,
    };
  },
};

const esbuild: BundlerManifest = {
  configFiles: ['esbuild.config.mjs'],
  scripts({ platform }) {
    return {
      // One-shot build → `dist/` (dist + watch serve modes). esbuild has no dev
      // server; the config selects its target from the platform argument.
      build: `node esbuild.config.mjs ${platform}`,
      // Rebuild-on-change (watch serve mode).
      watch: `node esbuild.config.mjs ${platform} --watch`,
    };
  },
};

const MANIFESTS: Partial<Record<Bundler, BundlerManifest>> = {
  vite,
  webpack,
  esbuild,
};

export function getManifest(bundler: Bundler): BundlerManifest {
  const manifest = MANIFESTS[bundler];
  if (!manifest) {
    throw new Error(`No fixture manifest registered for bundler "${bundler}" yet.`);
  }
  return manifest;
}

/** Whether the fixture builder has a template/manifest for `bundler`. */
export function isBundlerImplemented(bundler: Bundler): boolean {
  return MANIFESTS[bundler] !== undefined;
}
