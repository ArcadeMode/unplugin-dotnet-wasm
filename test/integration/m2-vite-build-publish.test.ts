import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve, join } from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import { IsolatedViteBuild } from './vite-build-helper.js';

// ---------------------------------------------------------------------------
// Prerequisite: pnpm build:library:fingerprint (or :nofingerprint) must have
// run first so that bin/Release/net10.0/publish/ is populated.
// ---------------------------------------------------------------------------

const FIXTURE_DIR = resolve(__dirname, '../fixtures/library-build');
const LIBRARY_DIR = resolve(__dirname, '../fixtures/Library');
const PUBLISH_DIR = join(LIBRARY_DIR, 'bin', 'Release', 'net10.0', 'publish');

// Shared assertions re-used by both describe blocks.
function assertPublishBuild(vb: IsolatedViteBuild): void {
  it('builds without "Could not resolve" warnings', () => {
    const bad = vb.warnings.filter(w => w.includes('Could not resolve'));
    expect(bad).toHaveLength(0);
  });

  it('emits at least one .wasm file in dist/assets/', () => {
    const wasmFiles = readdirSync(vb.assets).filter(f => f.endsWith('.wasm'));
    expect(wasmFiles.length).toBeGreaterThan(0);
  });

  it('Library*.wasm is present (user assembly emitted)', () => {
    const files = readdirSync(vb.assets);
    expect(files.some(f => /^Library[.-][^/]+\.wasm$/.test(f))).toBe(true);
  });

  it('dotnet.native*.wasm byte length matches publish source', () => {
    const distFiles = readdirSync(vb.assets);
    const distFile = distFiles.find(f => /^dotnet\.native[.-][^/]+\.wasm$/.test(f));
    expect(distFile).toBeDefined();

    const frameworkDir = join(PUBLISH_DIR, 'wwwroot', '_framework');
    const srcName = readdirSync(frameworkDir).find(f => /^dotnet\.native.*\.wasm$/.test(f))!;
    expect(statSync(join(vb.assets, distFile!)).size).toBe(
      statSync(join(frameworkDir, srcName)).size,
    );
  });

  it('entry chunk references a *.wasm asset URL', () => {
    const jsFiles = readdirSync(vb.assets).filter(f => /^index-.*\.js$/.test(f));
    expect(jsFiles.length).toBeGreaterThan(0);
    const content = require('node:fs').readFileSync(join(vb.assets, jsFiles[0]!), 'utf8');
    expect(content).toMatch(/\.wasm/);
  });
}

// ---------------------------------------------------------------------------
// isPublish: true  (discovery variant — walks bin/Release/net10.0/publish/)
// ---------------------------------------------------------------------------

describe('M2 — Vite publish build (isPublish: true)', () => {
  const vb = new IsolatedViteBuild('m2-ispublish');

  beforeAll(() => vb.build(FIXTURE_DIR, {
    projectRoot: LIBRARY_DIR,
    projectName: 'Library',
    configuration: 'Release',
    targetFramework: 'net10.0',
    isPublish: true,
  }), 30_000);

  afterAll(() => vb.cleanup());

  assertPublishBuild(vb);
});

// ---------------------------------------------------------------------------
// dotnetOutputDir  (explicit variant — caller supplies the directory directly)
// ---------------------------------------------------------------------------

describe('M2 — Vite publish build (explicit dotnetOutputDir)', () => {
  const vb = new IsolatedViteBuild('m2-dotnet-output-dir');

  beforeAll(() => vb.build(FIXTURE_DIR, {
    projectName: 'Library',
    dotnetOutputDir: PUBLISH_DIR,
  }), 30_000);

  afterAll(() => vb.cleanup());

  assertPublishBuild(vb);
});
