import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { getManifest } from './manifest';
import type { BuildFixtureOptions, BuildMode, ServeMode } from './types';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** `test/fixture-builder` package root. */
export const PACKAGE_ROOT = resolve(__dirname, '..');
export const TEMPLATES_DIR = join(PACKAGE_ROOT, 'templates');
export const MATERIALIZED_ROOT = join(PACKAGE_ROOT, '.materialized');

export interface MaterializedProject {
  /** Unique identifier for this instance. */
  id: string;
  /** Instance root; contains the sibling `app/` and `Library/` dirs. */
  rootDir: string;
  /** The node project root (`<rootDir>/app`): package.json, config, src. */
  dir: string;
  /** The isolated .NET Library copy (`<rootDir>/Library`), referenced out-of-tree as `../Library`. */
  libraryDir: string;
}

interface MaterializeInput {
  options: Required<Pick<BuildFixtureOptions, 'bundler' | 'platform' | 'serveMode' | 'buildMode'>>;
  port: number;
}

/** A collision-proof id: dimensions + timestamp + random segment. */
function makeId(input: MaterializeInput): string {
  const { bundler, platform, serveMode } = input.options;
  const stamp = Date.now().toString(36);
  const rand = randomBytes(4).toString('hex');
  return `${bundler}-${platform}-${serveMode}-${stamp}-${rand}`;
}

/**
 * Generate a runnable project on disk from templates. No `npm install` is run:
 * the project lives under the fixture-builder package so Node resolves
 * `node_modules` upward. An empty local `node_modules` is created so the
 * plugin's type-shim generator writes into this isolated dir.
 *
 * Layout: `<id>/app` (the node project) and `<id>/Library` (the isolated .NET
 * Library) are siblings, so the app references the Library out-of-tree via
 * `../Library` and no bundler dev-server watcher ever scans the Library's
 * churning bin/obj output.
 */
export function materialize(input: MaterializeInput): MaterializedProject {
  const { options, port } = input;
  const id = makeId(input);
  const rootDir = join(MATERIALIZED_ROOT, id);
  const dir = join(rootDir, 'app');
  const libraryDir = join(rootDir, 'Library');

  mkdirSync(dir, { recursive: true });
  // Anchor plugin shim-package generation to this isolated app project.
  mkdirSync(join(dir, 'node_modules'), { recursive: true });

  // Shared assets: entry + html + base tsconfig.
  mkdirSync(join(dir, 'src'), { recursive: true });
  cpSync(join(TEMPLATES_DIR, 'shared', 'entry.ts'), join(dir, 'src', 'entry.ts'));
  cpSync(join(TEMPLATES_DIR, 'shared', 'index.html'), join(dir, 'index.html'));
  cpSync(join(TEMPLATES_DIR, 'shared', 'tsconfig.base.json'), join(dir, 'tsconfig.json'));

  // Isolated .NET Library copy, out-of-tree sibling of the app (../Library).
  cpSync(join(TEMPLATES_DIR, 'library'), libraryDir, { recursive: true });

  // Bundler config(s), copied verbatim into the app.
  const manifest = getManifest(options.bundler);
  for (const file of manifest.configFiles) {
    cpSync(join(TEMPLATES_DIR, 'bundlers', options.bundler, file), join(dir, file));
  }

  writeFileSync(join(dir, 'package.json'), generatePackageJson(id, options, port), 'utf8');

  return { id, rootDir, dir, libraryDir };
}

function generatePackageJson(
  id: string,
  options: MaterializeInput['options'],
  port: number,
): string {
  const manifest = getManifest(options.bundler);
  const scripts = manifest.scripts({
    platform: options.platform,
    serveMode: options.serveMode,
    buildMode: options.buildMode,
    port,
  });
  // Every node fixture runs its built artifact the same way; the bundlers all
  // emit `dist/entry.js`, so the `start` script is platform-universal.
  if (options.platform === 'node') {
    scripts.start ??= 'node dist/entry.js';
  }
  // Deps are intentionally omitted — inherited via upward node_modules nesting.
  const pkg = {
    name: `@dotnet-wasm-bundler/materialized-${id}`,
    private: true,
    version: '0.0.0',
    type: 'module',
    scripts,
  };
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

export function distDir(project: MaterializedProject): string {
  return join(project.dir, 'dist');
}

export { type ServeMode, type BuildMode };
