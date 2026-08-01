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
  /** Materialized project root (contains package.json, config, src, Library). */
  dir: string;
  /** The isolated .NET Library copy inside the project. */
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
 */
export function materialize(input: MaterializeInput): MaterializedProject {
  const { options, port } = input;
  const id = makeId(input);
  const dir = join(MATERIALIZED_ROOT, id);
  const libraryDir = join(dir, 'Library');

  mkdirSync(dir, { recursive: true });
  // Anchor plugin shim-package generation to this isolated project.
  mkdirSync(join(dir, 'node_modules'), { recursive: true });

  // Shared assets: entry + html + base tsconfig.
  mkdirSync(join(dir, 'src'), { recursive: true });
  const entrySrc = options.platform === 'node' ? 'entry.node.ts' : 'entry.browser.ts';
  cpSync(join(TEMPLATES_DIR, 'shared', entrySrc), join(dir, 'src', 'entry.ts'));
  cpSync(join(TEMPLATES_DIR, 'shared', 'index.html'), join(dir, 'index.html'));
  cpSync(join(TEMPLATES_DIR, 'shared', 'tsconfig.base.json'), join(dir, 'tsconfig.json'));

  // Isolated .NET Library copy (mutated only via gitignored bin/obj on build).
  cpSync(join(TEMPLATES_DIR, 'library'), libraryDir, { recursive: true });

  // Bundler config(s), copied verbatim.
  const manifest = getManifest(options.bundler);
  for (const file of manifest.configFiles) {
    cpSync(join(TEMPLATES_DIR, 'bundlers', options.bundler, file), join(dir, file));
  }

  writeFileSync(join(dir, 'package.json'), generatePackageJson(id, options, port), 'utf8');

  return { id, dir, libraryDir };
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
