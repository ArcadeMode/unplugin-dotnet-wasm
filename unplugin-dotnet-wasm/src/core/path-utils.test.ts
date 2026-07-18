import { describe, it, expect } from 'vitest';
import { collapseDotSegments, normalizePath } from './path-utils';

describe('collapseDotSegments', () => {
  it("collapses './' segments", () => {
    expect(collapseDotSegments('a/./b')).toBe('a/b');
  });

  it("resolves '..' segments", () => {
    expect(collapseDotSegments('a/b/../c')).toBe('a/c');
  });

  it('collapses empty segments from double slashes', () => {
    expect(collapseDotSegments('a//b')).toBe('a/b');
  });

  it('removes leading slash', () => {
    expect(collapseDotSegments('/a/b')).toBe('a/b');
  });

  it('returns empty string for empty input', () => {
    expect(collapseDotSegments('')).toBe('');
  });

  it("pops segments for '..' that escape above root", () => {
    expect(collapseDotSegments('a/../..')).toBe('');
  });
});

describe('normalizePath', () => {
  it('returns POSIX path with case PRESERVED and a case-folded lookupKey', () => {
    expect(normalizePath('\\_Framework\\.\\Dotnet.JS')).toEqual({
      path: '_Framework/Dotnet.JS',
      lookupKey: '_framework/dotnet.js',
    });
  });

  it('resolves dot segments in both fields', () => {
    expect(normalizePath('/_Framework/../_Content/App.WASM')).toEqual({
      path: '_Content/App.WASM',
      lookupKey: '_content/app.wasm',
    });
  });

  it('returns empty strings for empty input', () => {
    expect(normalizePath('')).toEqual({ path: '', lookupKey: '' });
  });
});
