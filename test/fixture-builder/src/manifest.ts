import type { BuildMode, Bundler, Platform, ServeMode } from './types';

export interface ScriptContext {
  platform: Platform;
  serveMode: ServeMode;
  buildMode: BuildMode;
  port: number;
}

export interface BundlerManifest {
  configFiles: string[];
  scripts(ctx: ScriptContext): Record<string, string>;
}

function bundlerMode(buildMode: BuildMode): 'development' | 'production' {
  return buildMode === 'publish' ? 'production' : 'development';
}

const vite: BundlerManifest = {
  configFiles: ['vite.config.ts', 'vitest.harness.config.ts', 'runtime.harness.test.ts'],
  scripts({ port, buildMode, platform }) {
    const mode = bundlerMode(buildMode);
    return {
      build: `vite build --mode ${mode}`,
      watch: `vite build --watch --mode ${mode}`,
      dev:
        platform === 'node'
          ? `vitest run --mode ${mode} --config vitest.harness.config.ts`
          : `vite --port ${port} --strictPort --mode ${mode}`,
    };
  },
};

const webpack: BundlerManifest = {
  configFiles: ['webpack.config.mjs'],
  scripts({ port, buildMode }) {
    const mode = bundlerMode(buildMode);
    const config = '--config webpack.config.mjs';
    return {
      build: `webpack ${config} --mode ${mode}`,
      watch: `webpack ${config} --watch --mode ${mode}`,
      dev: `webpack serve ${config} --port ${port} --mode ${mode}`,
    };
  },
};

const esbuild: BundlerManifest = {
  configFiles: ['esbuild.config.mjs'],
  scripts({ platform }) {
    return {
      build: `node esbuild.config.mjs ${platform}`,
      watch: `node esbuild.config.mjs ${platform} --watch`,
    };
  },
};

const rollup: BundlerManifest = {
  configFiles: ['rollup.config.mjs'],
  scripts() {
    return {
      build: 'rollup -c rollup.config.mjs',
      watch: 'rollup -c rollup.config.mjs --watch',
    };
  },
};

const rolldown: BundlerManifest = {
  configFiles: ['rolldown.config.mjs'],
  scripts() {
    return {
      build: 'rolldown -c rolldown.config.mjs',
      watch: 'rolldown -c rolldown.config.mjs --watch',
    };
  },
};

const rspack: BundlerManifest = {
  configFiles: ['rspack.config.mjs'],
  scripts({ port, buildMode, platform }) {
    const mode = bundlerMode(buildMode);
    const config = '--config rspack.config.mjs';
    const scripts: Record<string, string> = {
      build: `rspack build ${config} --mode ${mode}`,
      watch: `rspack build ${config} --watch --mode ${mode}`,
    };
    if (platform === 'browser') {
      scripts.dev = `rspack serve ${config} --port ${port} --mode ${mode}`;
    }
    return scripts;
  },
};

const rsbuild: BundlerManifest = {
  configFiles: ['rsbuild.config.ts'],
  scripts({ port, buildMode, platform }) {
    const mode = bundlerMode(buildMode);
    const scripts: Record<string, string> = {
      build: `rsbuild build --env-mode ${mode}`,
      watch: `rsbuild build --watch --env-mode ${mode}`,
    };
    if (platform === 'browser') {
      scripts.dev = `rsbuild dev --port ${port} --env-mode ${mode}`;
    }
    return scripts;
  },
};

const farm: BundlerManifest = {
  configFiles: ['farm.config.ts'],
  scripts({ port, buildMode, platform }) {
    const mode = bundlerMode(buildMode);
    const scripts: Record<string, string> = {
      build: `farm build --mode ${mode}`,
      watch: `farm build --watch --mode ${mode}`,
    };
    if (platform === 'browser') {
      scripts.dev = `farm dev --port ${port}`;
    }
    return scripts;
  },
};

const bun: BundlerManifest = {
  configFiles: ['bun.build.ts'],
  scripts() {
    return {
      // Dist-only; bun has no watch/dev-server support in the plugin yet.
      build: 'bun bun.build.ts',
    };
  },
};

const MANIFESTS: Partial<Record<Bundler, BundlerManifest>> = {
  vite,
  webpack,
  esbuild,
  rollup,
  rolldown,
  rspack,
  rsbuild,
  farm,
  bun,
};

export function getManifest(bundler: Bundler): BundlerManifest {
  const manifest = MANIFESTS[bundler];
  if (!manifest) {
    throw new Error(`No fixture manifest registered for bundler "${bundler}" yet.`);
  }
  return manifest;
}

export function isBundlerImplemented(bundler: Bundler): boolean {
  return MANIFESTS[bundler] !== undefined;
}
