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
  it("fileFor('') returns index.d.ts", () => {
    const baseDir = '/test/node_modules';
    const locator = createMockLocator(baseDir);
    const pkg = new ShimPackage(locator, 'my-pkg');

    const { relFile, absFile } = pkg.fileFor('');

    expect(relFile).toBe('index.d.ts');
    expect(absFile).toBe(join(baseDir, 'my-pkg', 'index.d.ts'));
  });

  it("fileFor('sub') returns sub/index.d.ts", () => {
    const baseDir = '/test/node_modules';
    const locator = createMockLocator(baseDir);
    const pkg = new ShimPackage(locator, 'my-pkg');

    const { relFile, absFile } = pkg.fileFor('sub');

    expect(relFile).toBe('sub/index.d.ts');
    expect(absFile).toBe(join(baseDir, 'my-pkg', 'sub/index.d.ts'));
  });

  it("fileFor('sub/path') returns sub/path/index.d.ts", () => {
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

  it('emits sorted export keys for deterministic (idempotent) manifests', () => {
    const locator = createMockLocator('/test/node_modules');
    const pkg = new ShimPackage(locator, 'my-pkg');

    // Add in non-sorted order; two aliases share one file.
    pkg.addExport('foo.js', 'foo/index.d.ts');
    pkg.addExport('foo', 'foo/index.d.ts');

    const json = JSON.parse(pkg.emitPackageJson()!.json);
    expect(Object.keys(json.exports)).toEqual(['./foo', './foo.js']);
    expect(json.exports['./foo']).toEqual({ types: './foo/index.d.ts' });
    expect(json.exports['./foo.js']).toEqual({ types: './foo/index.d.ts' });
  });
});
