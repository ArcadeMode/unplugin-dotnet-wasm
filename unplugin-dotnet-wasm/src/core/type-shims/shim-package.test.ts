import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { ShimPackage } from './shim-package';
import type { NodeModulesLocator } from './node-modules-locator';

// Mock locator that returns a fixed directory
function createMockLocator(baseDir: string): NodeModulesLocator {
  return {
    resolve: () => baseDir,
  } as NodeModulesLocator;
}

describe('ShimPackage', () => {
  it('exposes dir as public readonly', () => {
    const baseDir = '/test/node_modules';
    const locator = createMockLocator(baseDir);
    const pkg = new ShimPackage(locator, 'my-pkg');

    expect(pkg.dir).toBe(join(baseDir, 'my-pkg'));
  });

  it('fileFor(\'\') returns index.d.ts', () => {
    const baseDir = '/test/node_modules';
    const locator = createMockLocator(baseDir);
    const pkg = new ShimPackage(locator, 'my-pkg');

    const { relFile, absFile } = pkg.fileFor('');

    expect(relFile).toBe('index.d.ts');
    expect(absFile).toBe(join(baseDir, 'my-pkg', 'index.d.ts'));
  });

  it('fileFor(\'sub\') returns sub/index.d.ts', () => {
    const baseDir = '/test/node_modules';
    const locator = createMockLocator(baseDir);
    const pkg = new ShimPackage(locator, 'my-pkg');

    const { relFile, absFile } = pkg.fileFor('sub');

    expect(relFile).toBe('sub/index.d.ts');
    expect(absFile).toBe(join(baseDir, 'my-pkg', 'sub/index.d.ts'));
  });

  it('fileFor(\'sub/path\') returns sub/path/index.d.ts', () => {
    const baseDir = '/test/node_modules';
    const locator = createMockLocator(baseDir);
    const pkg = new ShimPackage(locator, 'my-pkg');

    const { relFile, absFile } = pkg.fileFor('sub/path');

    expect(relFile).toBe('sub/path/index.d.ts');
    expect(absFile).toBe(join(baseDir, 'my-pkg', 'sub/path/index.d.ts'));
  });

  it('addExport records exports with correct keys', () => {
    const baseDir = '/test/node_modules';
    const locator = createMockLocator(baseDir);
    const pkg = new ShimPackage(locator, 'my-pkg');

    pkg.addExport('', 'index.d.ts');
    pkg.addExport('sub', 'sub/index.d.ts');

    const manifest = pkg.emitPackageJson();
    expect(manifest).not.toBeNull();
    expect(manifest!.json).toContain('"."');
    expect(manifest!.json).toContain('"./sub"');
  });

  it('emit() returns null when no exports were added', () => {
    const baseDir = '/test/node_modules';
    const locator = createMockLocator(baseDir);
    const pkg = new ShimPackage(locator, 'my-pkg');

    const manifest = pkg.emitPackageJson();

    expect(manifest).toBeNull();
  });

  it('emit() returns the correct package.json structure', () => {
    const baseDir = '/test/node_modules';
    const locator = createMockLocator(baseDir);
    const pkg = new ShimPackage(locator, 'my-pkg');

    pkg.addExport('', 'index.d.ts');
    pkg.addExport('sub', 'sub/index.d.ts');

    const manifest = pkg.emitPackageJson();
    expect(manifest).not.toBeNull();
    expect(manifest!.path).toBe(join(baseDir, 'my-pkg', 'package.json'));

    const json = JSON.parse(manifest!.json);
    expect(json.name).toBe('my-pkg');
    expect(json.version).toBe('0.0.0');
    expect(json.private).toBe(true);
    expect(json.exports['.']).toEqual({ types: './index.d.ts' });
    expect(json.exports['./sub']).toEqual({ types: './sub/index.d.ts' });
  });
});
