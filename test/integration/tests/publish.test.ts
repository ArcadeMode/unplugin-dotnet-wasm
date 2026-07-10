import { it, expect, beforeAll, afterAll } from 'vitest';
import { resolve, join } from 'node:path';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createIsolatedBuild, type IsolatedBundlerBuild } from '../bundlers/index';
import { describeWhen, currentBundler, currentPlatform, getFixtureDir } from '../test-matrix';

const FIXTURE_DIR = getFixtureDir();
const LIBRARY_DIR = resolve(__dirname, '../../fixtures/Library');
const PUBLISH_DIR = join(LIBRARY_DIR, 'bin', 'Release', 'net10.0', 'publish');

function assertPublishBuild(vb: IsolatedBundlerBuild): void {
  it('builds without "Could not resolve" warnings', () => {
    const bad = vb.warnings.filter(w => w.includes('Could not resolve'));
    expect(bad).toHaveLength(0);
  });

  it('emits at least one .wasm file in dist/assets/', () => {
    const wasmFiles = readdirSync(vb.assets).filter(f => f.endsWith('.wasm'));
    expect(wasmFiles.length).toBeGreaterThan(0);
  });

  it('Library*.wasm is emitted including hash', () => {
    const files = readdirSync(vb.assets);
    expect(files.some(f => /^Library([.-][^/]+)?\.wasm$/.test(f))).toBe(true);
  });

  it('dotnet.native*.wasm byte length matches publish source', () => {
    const distFiles = readdirSync(vb.assets);
    const distFile = distFiles.find(f => /^dotnet(\.native)?[.-][^/]+\.wasm$/.test(f));
    expect(distFile).toBeDefined();
    const frameworkDir = join(PUBLISH_DIR, 'wwwroot', '_framework');
    const srcName = readdirSync(frameworkDir).find(f => /^dotnet\.native(\.[a-z0-9]+)?\.wasm$/.test(f))!;
    expect(srcName).toBeDefined();
    const srcPath = join(frameworkDir, srcName);
    expect(statSync(join(vb.assets, distFile!)).size).toBe(statSync(srcPath).size);
  });

  it('entry chunk references a *.wasm asset URL', () => {
    const content = readFileSync(vb.entryChunk, 'utf8');
    expect(content).toMatch(/\.wasm/);
  });
}

describeWhen({ buildModes: ['publish'] })('Publish build (isPublish: true)', () => {
  const vb = createIsolatedBuild(currentBundler, FIXTURE_DIR, currentPlatform, 'm2-ispublish');

  beforeAll(() => vb.build({
    projectRoot: LIBRARY_DIR,
    projectName: 'Library',
    configuration: 'Release',
    targetFramework: 'net10.0',
    isPublish: true,
  }), 60_000);

  afterAll(() => vb.cleanup());

  assertPublishBuild(vb);
});

describeWhen({ buildModes: ['publish'] })('Publish build (explicit dotnetOutputDir)', () => {
  const vb = createIsolatedBuild(currentBundler, FIXTURE_DIR, currentPlatform, 'm2-dotnet-output-dir');

  beforeAll(() => vb.build({
    projectName: 'Library',
    dotnetOutputDir: PUBLISH_DIR,
  }), 60_000);

  afterAll(() => vb.cleanup());

  assertPublishBuild(vb);
});


describeWhen({ buildModes: ['none'] })('DiscoveryError when publish output is absent', () => {
  it('isPublish: true → fails naming the searched publish dir', async () => {
    const vb = createIsolatedBuild(currentBundler, FIXTURE_DIR, currentPlatform, 'm2-3-discovery');
    try {
      const expectedDir = join(PUBLISH_DIR);
      await expect(vb.build({
        projectRoot: LIBRARY_DIR,
        projectName: 'Library',
        configuration: 'Release',
        targetFramework: 'net10.0',
        isPublish: true,
      })).rejects.toThrow(/Endpoints manifest not found at .*publish/);

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
    const vb = createIsolatedBuild(currentBundler, FIXTURE_DIR, currentPlatform, 'm2-3-explicit');
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
