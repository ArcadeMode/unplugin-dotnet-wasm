import { describe, expect, it } from 'vitest';
import { ExtensionProbes } from './extension-probes.js';

describe('ExtensionProbes', () => {
  it('yields only the verbatim source when it already has an extension', () => {
    expect([...new ExtensionProbes('foo.js')]).toEqual(['foo.js']);
  });

  it('expands an extensionless source into [bare, ...<bare>.<ext>, ...<bare>/index.<ext>]', () => {
    expect([...new ExtensionProbes('bare')]).toEqual([
      'bare',
      'bare.ts',
      'bare.tsx',
      'bare.mts',
      'bare.cts',
      'bare.js',
      'bare.jsx',
      'bare.mjs',
      'bare.cjs',
      'bare.json',
      'bare/index.ts',
      'bare/index.tsx',
      'bare/index.mts',
      'bare/index.cts',
      'bare/index.js',
      'bare/index.jsx',
      'bare/index.mjs',
      'bare/index.cjs',
      'bare/index.json',
    ]);
  });

  it('produces a fresh iterator on each iteration', () => {
    const probes = new ExtensionProbes('bare');
    expect([...probes]).toEqual([...probes]);
  });
});
