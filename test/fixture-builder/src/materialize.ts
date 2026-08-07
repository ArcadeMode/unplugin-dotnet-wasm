import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { getManifest } from './manifest';
import type { BuildFixtureOptions, BuildMode, ServeMode } from './types';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = resolve(__dirname, '..');
export const TEMPLATES_DIR = join(PACKAGE_ROOT, 'templates');
export const TEMPLATE_LIBRARY_DIR = join(TEMPLATES_DIR, 'library');
export const MATERIALIZED_ROOT = join(PACKAGE_ROOT, '.materialized');

export interface MaterializedProject {
  id: string;
  rootDir: string;
  dir: string;
  libraryDir: string;
}

interface MaterializeInput {
  options: Required<Pick<BuildFixtureOptions, 'bundler' | 'platform' | 'serveMode' | 'buildMode'>>;
  port: number;
  clean?: boolean;
}

function makeId(input: MaterializeInput): string {
  const { bundler, platform, serveMode } = input.options;
  const stamp = Date.now().toString(36);
  const rand = randomBytes(4).toString('hex');
  return `${bundler}-${platform}-${serveMode}-${stamp}-${rand}`;
}

export function materialize(input: MaterializeInput): MaterializedProject {
  const { options, port, clean = false } = input;
  const id = makeId(input);
  const rootDir = join(MATERIALIZED_ROOT, id);
  const dir = join(rootDir, 'app');
  const libraryDir = join(rootDir, 'Library');

  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'node_modules'), { recursive: true });

  mkdirSync(join(dir, 'src'), { recursive: true });
  cpSync(join(TEMPLATES_DIR, 'shared', 'entry.ts'), join(dir, 'src', 'entry.ts'));
  cpSync(join(TEMPLATES_DIR, 'shared', 'index.html'), join(dir, 'index.html'));
  cpSync(join(TEMPLATES_DIR, 'shared', 'tsconfig.base.json'), join(dir, 'tsconfig.json'));
  cpSync(join(TEMPLATES_DIR, 'shared', 'sentinel.mjs'), join(dir, 'sentinel.mjs'));

  cpSync(TEMPLATE_LIBRARY_DIR, libraryDir, {
    recursive: true,
    preserveTimestamps: true,
    filter: clean ? (src) => basename(src) !== 'bin' : undefined, // preserve obj to speed up next build.
  });

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
  if (options.platform === 'node') {
    scripts.start ??= 'node dist/entry.js';
  }
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
