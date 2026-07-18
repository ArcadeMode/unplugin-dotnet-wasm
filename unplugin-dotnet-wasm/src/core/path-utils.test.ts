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
    const n = normalizePath('\\_Framework\\.\\Dotnet.JS');
    expect(n.path).toBe('_Framework/Dotnet.JS');
    expect(n.lookupKey).toBe('_framework/dotnet.js');
  });

  it('resolves dot segments in both fields', () => {
    const n = normalizePath('/_Framework/../_Content/App.WASM');
    expect(n.path).toBe('_Content/App.WASM');
    expect(n.lookupKey).toBe('_content/app.wasm');
  });

  it('returns empty strings for empty input', () => {
    const n = normalizePath('');
    expect(n.path).toBe('');
    expect(n.lookupKey).toBe('');
  });
});
