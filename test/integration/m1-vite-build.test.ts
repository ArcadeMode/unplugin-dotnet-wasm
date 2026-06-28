import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve, join } from 'node:path';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { IsolatedViteBuild } from './vite-build-helper.js';

// ---------------------------------------------------------------------------
// Prerequisite: the plugin dist must be built before running this test.
//   pnpm --filter unplugin-dotnet-static-assets build
// ---------------------------------------------------------------------------

const FIXTURE_DIR = resolve(__dirname, '../fixtures/library-build');
const LIBRARY_DIR = resolve(__dirname, '../fixtures/Library');

const vb = new IsolatedViteBuild('m1-default');

describe('M1.6.b — Vite build smoke', () => {
  beforeAll(() => vb.build(FIXTURE_DIR, {
    projectRoot: LIBRARY_DIR,
    projectName: 'Library',
    configuration: 'Debug',
    targetFramework: 'net10.0',
  }), 10_000);

  afterAll(() => vb.cleanup());

  it('builds without "Could not resolve" warnings', () => {
    const bad = vb.warnings.filter(w => w.includes('Could not resolve'));
    expect(bad).toHaveLength(0);
  });

  it('dist/assets/ contains dotnet.native*.wasm', () => {
    // With fingerprinting the emitted name is e.g. dotnet.native.fp-vitehash.wasm;
    // without fingerprinting it is dotnet.native-vitehash.wasm.  Both are accepted.
    const files = readdirSync(vb.assets);
    expect(files.some(f => /^dotnet\.native[.-][^/]+\.wasm$/.test(f))).toBe(true);
  });

  it('dotnet.native*.wasm byte length matches source', () => {
    const files = readdirSync(vb.assets);
    const distFile = files.find(f => /^dotnet\.native[.-][^/]+\.wasm$/.test(f))!;
    // Source filename may be fingerprinted (dotnet.native.FP.wasm) or canonical.
    const frameworkDir = join(LIBRARY_DIR, 'bin', 'Debug', 'net10.0', 'wwwroot', '_framework');
    const srcName = readdirSync(frameworkDir).find(f => /^dotnet\.native.*\.wasm$/.test(f))!;
    const srcPath = join(frameworkDir, srcName);
    expect(statSync(join(vb.assets, distFile)).size).toBe(statSync(srcPath).size);
  });

  it('at least 20 distinct .wasm assets emitted', () => {
    const wasmFiles = readdirSync(vb.assets).filter(f => f.endsWith('.wasm'));
    expect(wasmFiles.length).toBeGreaterThanOrEqual(20);
  });

  it('Library*.wasm is present (user assembly emitted)', () => {
    // With fingerprinting the emitted name is e.g. Library.fp-vitehash.wasm;
    // without fingerprinting it is Library-vitehash.wasm.
    const files = readdirSync(vb.assets);
    expect(files.some(f => /^Library[.-][^/]+\.wasm$/.test(f))).toBe(true);
  });

  it('entry chunk references a *.wasm asset URL', () => {
    // When built from index.html, Vite names the main chunk "index-{hash}.js"
    const jsFiles = readdirSync(vb.assets).filter(f => /^index-.*\.js$/.test(f));
    expect(jsFiles.length).toBeGreaterThan(0);
    const content = readFileSync(join(vb.assets, jsFiles[0]!), 'utf8');
    expect(content).toMatch(/\.wasm/);
  });
});
