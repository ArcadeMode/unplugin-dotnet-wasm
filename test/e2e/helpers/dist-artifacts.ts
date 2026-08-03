import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { libraryOutputDir, type Fixture } from '@dotnet-wasm-bundler/fixture-builder';

const FINGERPRINTED_LIBRARY_RE = /^Library\.[a-z0-9]+\.wasm$/;

export function distAssetsDir(fixture: Fixture): string {
  return join(fixture.dir, 'dist', 'assets');
}

export function entryChunkPath(fixture: Fixture): string {
  const dist = join(fixture.dir, 'dist');
  if (fixture.platform === 'node') return join(dist, 'entry.js');

  const assetsEntry = join(dist, 'assets', 'entry.js');
  if (existsSync(assetsEntry)) return assetsEntry;

  const flatEntry = join(dist, 'entry.js');
  if (existsSync(flatEntry)) return flatEntry;

  const assetsDir = join(dist, 'assets');
  const hashed = readdirSync(assetsDir).find((f) => /^index([._-].+)?\.js$/.test(f));
  if (!hashed) throw new Error(`Could not locate the browser entry chunk under ${dist}`);
  return join(assetsDir, hashed);
}

export function libraryFrameworkDir(fixture: Fixture): string {
  return join(libraryOutputDir(fixture.libraryDir, fixture.buildMode), 'wwwroot', '_framework');
}

export function libraryPublishDir(fixture: Fixture): string {
  return libraryOutputDir(fixture.libraryDir, 'publish');
}

// TODO: bring to assertions.ts
export function expectFingerprintLayout(dir: string, fingerprint: boolean): void {
  const libraryWasms = readdirSync(dir).filter((f) => /^Library.*\.wasm$/.test(f));
  const hasCanonical = libraryWasms.includes('Library.wasm');
  const fingerprinted = libraryWasms.filter((f) => FINGERPRINTED_LIBRARY_RE.test(f));

  if (fingerprint) {
    if (fingerprinted.length === 0) {
      throw new Error(
        `Expected fingerprinted Library.<hash>.wasm under ${dir}, found: ${libraryWasms.join(', ') || '(none)'}`,
      );
    }
  } else {
    if (!hasCanonical) {
      throw new Error(
        `Expected canonical Library.wasm under ${dir}, found: ${libraryWasms.join(', ') || '(none)'}`,
      );
    }
    if (fingerprinted.length > 0) {
      throw new Error(
        `Expected no fingerprinted Library.<hash>.wasm under ${dir}, found: ${fingerprinted.join(', ')}`,
      );
    }
  }
}
