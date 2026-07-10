import { it, expect, beforeAll, afterAll } from 'vitest';
import { resolve, join } from 'node:path';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { createIsolatedBuild } from '../bundlers/index.js';
import { describeWhen, currentBundler, currentPlatform, getFixtureDir } from '../test-matrix.js';

const FIXTURE_DIR = getFixtureDir();
const LIBRARY_DIR = resolve(__dirname, '../../fixtures/Library');

describeWhen({ buildModes: ['debug'] })('Build non-publish (Debug config + scattered output)', () => {
  const vb = createIsolatedBuild(currentBundler, FIXTURE_DIR, currentPlatform, 'm1-default');

  beforeAll(() => vb.build({
    projectRoot: LIBRARY_DIR,
    projectName: 'Library',
    configuration: 'Debug',
    targetFramework: 'net10.0',
  }), 60_000);

  afterAll(() => vb.cleanup());

  it('builds without "Could not resolve" warnings', () => {
    const bad = vb.warnings.filter(w => w.includes('Could not resolve'));
    expect(bad).toHaveLength(0);
  });

  it('dist/assets/ contains dotnet.native*.wasm', () => {
    const files = readdirSync(vb.assets);
    expect(files.some(f => /^dotnet(\.native)?[.-][^/]+\.wasm$/.test(f))).toBe(true);
  });

  it('dotnet.native*.wasm byte length matches source', () => {
    const files = readdirSync(vb.assets);
    const distFile = files.find(f => /^dotnet(\.native)?[.-][^/]+\.wasm$/.test(f))!;
    const frameworkDir = join(LIBRARY_DIR, 'bin', 'Debug', 'net10.0', 'wwwroot', '_framework');
    const srcName = readdirSync(frameworkDir).find(f => /^dotnet\.native(\.[a-z0-9]+)?\.wasm$/.test(f))!;
    expect(srcName).toBeDefined();
    const srcPath = join(frameworkDir, srcName);
    expect(statSync(join(vb.assets, distFile)).size).toBe(statSync(srcPath).size);
  });

  it('at least 20 distinct .wasm assets emitted', () => {
    const wasmFiles = readdirSync(vb.assets).filter(f => f.endsWith('.wasm'));
    expect(wasmFiles.length).toBeGreaterThanOrEqual(20);
  });

  it('Library*.wasm is present (user assembly emitted)', () => {
    const files = readdirSync(vb.assets);
    expect(files.some(f => /^Library([.-][^/]+)?\.wasm$/.test(f))).toBe(true);
  });

  it('entry chunk references a *.wasm asset URL', () => {
    const content = readFileSync(vb.entryChunk, 'utf8');
    expect(content).toMatch(/\.wasm/);
  });
});
