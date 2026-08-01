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

const MANIFESTS: Partial<Record<Bundler, BundlerManifest>> = {
  vite,
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
