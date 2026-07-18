import { describe, it, expect } from 'vitest';
import { collapseDotSegments, normalizeRoute } from './path-utils';

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

describe('normalizeRoute', () => {
  it('lowercases the path after collapsing dot segments', () => {
    expect(normalizeRoute('/_Framework/./Dotnet.JS')).toBe('_framework/dotnet.js');
  });

  it('collapses dots and lowercases together', () => {
    expect(normalizeRoute('/_Framework/../_Framework/DOTNET.js')).toBe('_framework/dotnet.js');
  });
});
