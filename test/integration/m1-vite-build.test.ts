import { describe, it, expect, beforeAll } from 'vitest';
import { build, createLogger } from 'vite';
import { resolve, join } from 'node:path';
import { readdirSync, statSync, readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Prerequisite: the plugin dist must be built before running this test.
//   pnpm --filter unplugin-dotnet-static-assets build
// ---------------------------------------------------------------------------

const FIXTURE_DIR = resolve(__dirname, '../fixtures/library-build');
const LIBRARY_DIR = resolve(__dirname, '../fixtures/Library');
const DIST_ASSETS = join(FIXTURE_DIR, 'dist', 'assets');

let buildWarnings: string[] = [];

describe('M1.6.b — Vite build smoke', () => {
  beforeAll(async () => {
    buildWarnings = [];
    const logger = createLogger('warn');
    const origWarn = logger.warn.bind(logger);
    logger.warn = (msg, options) => {
      buildWarnings.push(msg);
      origWarn(msg, options);
    };

    await build({
      root: FIXTURE_DIR,
      logLevel: 'warn',
      customLogger: logger,
    });
  }, 120_000);

  it('builds without "Could not resolve" warnings', () => {
    const bad = buildWarnings.filter(w => w.includes('Could not resolve'));
    expect(bad).toHaveLength(0);
  });

  it('dist/assets/ contains dotnet.native-*.wasm', () => {
    const files = readdirSync(DIST_ASSETS);
    expect(files.some(f => /^dotnet\.native-[^/]+\.wasm$/.test(f))).toBe(true);
  });

  it('dotnet.native-*.wasm byte length matches source', () => {
    const files = readdirSync(DIST_ASSETS);
    const distFile = files.find(f => /^dotnet\.native-[^/]+\.wasm$/.test(f))!;
    const srcPath = join(
      LIBRARY_DIR,
      'bin', 'Debug', 'net10.0', 'wwwroot', '_framework', 'dotnet.native.wasm',
    );
    expect(statSync(join(DIST_ASSETS, distFile)).size).toBe(statSync(srcPath).size);
  });

  it('at least 20 distinct .wasm assets emitted', () => {
    const wasmFiles = readdirSync(DIST_ASSETS).filter(f => f.endsWith('.wasm'));
    expect(wasmFiles.length).toBeGreaterThanOrEqual(20);
  });

  it('Library-*.wasm is present (user assembly emitted)', () => {
    const files = readdirSync(DIST_ASSETS);
    expect(files.some(f => /^Library-[^/]+\.wasm$/.test(f))).toBe(true);
  });

  it('entry chunk references a *.wasm asset URL', () => {
    // When built from index.html, Vite names the main chunk "index-{hash}.js"
    const jsFiles = readdirSync(DIST_ASSETS).filter(f => /^index-.*\.js$/.test(f));
    expect(jsFiles.length).toBeGreaterThan(0);
    const content = readFileSync(join(DIST_ASSETS, jsFiles[0]!), 'utf8');
    expect(content).toMatch(/\.wasm/);
  });
});
