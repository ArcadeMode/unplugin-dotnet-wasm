import { it, expect, beforeAll, afterAll } from 'vitest';
import { resolve, join } from 'node:path';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { IsolatedViteBuild } from '../bundler-build-helper.js';
import { describeWhen, currentBundler } from '../test-matrix.js';

// Prerequisite for fingerprint/nofingerprint shapes: npm build:library:fingerprint (or :nofingerprint)
// The `none` shape covers the negative path: no publish output exists so dotnet clean should be ran before.

const FIXTURE_DIR = resolve(__dirname, `../../fixtures/library-build-${currentBundler}`);
const LIBRARY_DIR = resolve(__dirname, '../../fixtures/Library');
const PUBLISH_DIR = join(LIBRARY_DIR, 'bin', 'Release', 'net10.0', 'publish');

// Shared assertions re-used by both publish-build describe blocks.
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
    // Match canonical OR fingerprinted — fresh fingerprint publish has only the fingerprinted variant.
    const srcName = readdirSync(frameworkDir).find(f => /^dotnet\.native(\.[a-z0-9]+)?\.wasm$/.test(f))!;
    expect(srcName).toBeDefined();
    const srcPath = join(frameworkDir, srcName);
    expect(statSync(join(vb.assets, distFile!)).size).toBe(statSync(srcPath).size);
  });

  it('entry chunk references a *.wasm asset URL', () => {
    const jsFiles = readdirSync(vb.assets).filter(f => /^index-.*\.js$/.test(f));
    expect(jsFiles.length).toBeGreaterThan(0);
    const content = readFileSync(join(vb.assets, jsFiles[0]!), 'utf8');
    expect(content).toMatch(/\.wasm/);
  });
}

describeWhen({ shapes: ['fingerprint', 'nofingerprint'] })('Vite publish build (isPublish: true)', () => {
  const vb = new IsolatedViteBuild(FIXTURE_DIR, 'm2-ispublish');

  beforeAll(() => vb.build({
    projectRoot: LIBRARY_DIR,
    projectName: 'Library',
    configuration: 'Release',
    targetFramework: 'net10.0',
    isPublish: true,
  }), 30_000);

  afterAll(() => vb.cleanup());

  assertPublishBuild(vb);
});

describeWhen({ shapes: ['fingerprint', 'nofingerprint'] })('Vite publish build (explicit dotnetOutputDir)', () => {
  const vb = new IsolatedViteBuild(FIXTURE_DIR, 'm2-dotnet-output-dir');

  beforeAll(() => vb.build({
    projectName: 'Library',
    dotnetOutputDir: PUBLISH_DIR,
  }), 30_000);

  afterAll(() => vb.cleanup());

  assertPublishBuild(vb);
});


describeWhen({ shapes: ['none'] })('DiscoveryError when publish output is absent', () => {
  it('isPublish: true → fails naming the searched publish dir', async () => {
    const vb = new IsolatedViteBuild(FIXTURE_DIR, 'm2-3-discovery');
    try {
      const expectedDir = join(PUBLISH_DIR);
      await expect(vb.build({
        projectRoot: LIBRARY_DIR,
        projectName: 'Library',
        configuration: 'Release',
        targetFramework: 'net10.0',
        isPublish: true,
      })).rejects.toThrow(/Endpoints manifest not found at .*publish/);

      // Re-run to capture the error object so we can assert the dir literally.
      const err = await vb.build({
        projectRoot: LIBRARY_DIR,
        projectName: 'Library',
        configuration: 'Release',
        targetFramework: 'net10.0',
        isPublish: true,
      }).catch((e: unknown) => e as Error);
      expect(String((err as Error).message)).toContain(expectedDir);
    } finally {
      vb.cleanup();
    }
  }, 30_000);

  it('dotnetOutputDir: <missing> → fails naming the given dir', async () => {
    const vb = new IsolatedViteBuild(FIXTURE_DIR, 'm2-3-explicit');
    const missingDir = join(tmpdir(), `dotnet-wasm-bundler-missing-${Date.now()}`);
    try {
      await expect(vb.build({
        projectName: 'Library',
        dotnetOutputDir: missingDir,
      })).rejects.toThrow(/Endpoints manifest not found/);

      const err = await vb.build({
        projectName: 'Library',
        dotnetOutputDir: missingDir,
      }).catch((e: unknown) => e as Error);
      expect(String((err as Error).message)).toContain(missingDir);
    } finally {
      vb.cleanup();
    }
  }, 30_000);
});
