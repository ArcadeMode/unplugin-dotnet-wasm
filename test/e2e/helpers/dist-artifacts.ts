import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { libraryOutputDir, type Fixture } from '@dotnet-wasm-bundler/fixture-builder';

/** Directory containing the hashed asset outputs (`.wasm`, `.dat`, …) under `dist/`. */
export function distAssetsDir(fixture: Fixture): string {
  return join(fixture.dir, 'dist', 'assets');
}

/**
 * Absolute path to the built entry chunk. Bundler/platform-specific:
 * - node: `dist/entry.js` (universal; see materialize.ts's generated `start` script).
 * - browser: `dist/assets/entry.js` (webpack), `dist/entry.js` (esbuild), or
 *   vite's hashed `dist/assets/index-<hash>.js`.
 */
export function entryChunkPath(fixture: Fixture): string {
  const dist = join(fixture.dir, 'dist');
  if (fixture.platform === 'node') return join(dist, 'entry.js');

  const assetsEntry = join(dist, 'assets', 'entry.js');
  if (existsSync(assetsEntry)) return assetsEntry;

  const flatEntry = join(dist, 'entry.js');
  if (existsSync(flatEntry)) return flatEntry;

  const assetsDir = join(dist, 'assets');
  const hashed = readdirSync(assetsDir).find((f) => /^index-.*\.js$/.test(f));
  if (!hashed) throw new Error(`Could not locate the browser entry chunk under ${dist}`);
  return join(assetsDir, hashed);
}

/**
 * The Library's own `_framework` output dir for `fixture`'s `buildMode` — the
 * source of truth diffed against the bundled `dist/assets` output.
 */
export function libraryFrameworkDir(fixture: Fixture): string {
  return join(libraryOutputDir(fixture.libraryDir, fixture.buildMode), 'wwwroot', '_framework');
}

/** The Library's `dotnet publish` output dir (`bin/Release/<tfm>/publish`). */
export function libraryPublishDir(fixture: Fixture): string {
  return libraryOutputDir(fixture.libraryDir, 'publish');
}
