import { describe, it, expect } from 'vitest';
import { TypeEntry, TS_ROUTE } from './type-entry';

describe('TypeEntry', () => {
  it('constructs from a root specifier route', () => {
    const entry = new TypeEntry('pkg.d.ts', '/path/to/pkg.d.ts', 'dts');

    expect(entry.pkgName).toBe('pkg');
    expect(entry.subpath).toBe('');
    expect(entry.physicalPath).toBe('/path/to/pkg.d.ts');
    expect(entry.kind).toBe('dts');
  });

  it('constructs from a nested route', () => {
    const entry = new TypeEntry('pkg/sub/mod.ts', '/path/to/pkg/sub/mod.ts', 'ts');

    expect(entry.pkgName).toBe('pkg');
    expect(entry.subpath).toBe('sub/mod');
    expect(entry.physicalPath).toBe('/path/to/pkg/sub/mod.ts');
    expect(entry.kind).toBe('ts');
  });

  it('strips .ts extension', () => {
    const entry = new TypeEntry('pkg/mod.ts', '/path/pkg/mod.ts', 'ts');

    expect(entry.pkgName).toBe('pkg');
    expect(entry.subpath).toBe('mod');
  });

  it('strips .d.ts extension', () => {
    const entry = new TypeEntry('pkg/mod.d.ts', '/path/pkg/mod.d.ts', 'dts');

    expect(entry.pkgName).toBe('pkg');
    expect(entry.subpath).toBe('mod');
  });

  it('strips .mts extension', () => {
    const entry = new TypeEntry('pkg/mod.mts', '/path/pkg/mod.mts', 'ts');

    expect(entry.pkgName).toBe('pkg');
    expect(entry.subpath).toBe('mod');
  });

  it('strips .cts extension', () => {
    const entry = new TypeEntry('pkg/mod.cts', '/path/pkg/mod.cts', 'ts');

    expect(entry.pkgName).toBe('pkg');
    expect(entry.subpath).toBe('mod');
  });

  it('handles multi-segment nested routes', () => {
    const entry = new TypeEntry('pkg/a/b/c.ts', '/path/pkg/a/b/c.ts', 'ts');

    expect(entry.pkgName).toBe('pkg');
    expect(entry.subpath).toBe('a/b/c');
  });

  it('passes through physicalPath unchanged', () => {
    const physicalPath = '/absolute/path/to/file.ts';
    const entry = new TypeEntry('pkg/mod.ts', physicalPath, 'ts');

    expect(entry.physicalPath).toBe(physicalPath);
  });

  it('passes through kind unchanged', () => {
    const entryDts = new TypeEntry('pkg.d.ts', '/path/pkg.d.ts', 'dts');
    expect(entryDts.kind).toBe('dts');

    const entryTs = new TypeEntry('pkg.ts', '/path/pkg.ts', 'ts');
    expect(entryTs.kind).toBe('ts');
  });
});
