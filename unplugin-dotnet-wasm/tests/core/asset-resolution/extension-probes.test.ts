import { describe, expect, it } from 'vitest';
import { ExtensionProbes } from '@src/core/asset-resolution/extension-probes';

const BARE_EXPANSION = [
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
];

describe('ExtensionProbes', () => {
  it('yields only the verbatim source when it ends with a probe suffix', () => {
    expect([...new ExtensionProbes('foo.js')]).toEqual(['foo.js']);
  });

  it('yields only the verbatim source for binary suffixes', () => {
    expect([...new ExtensionProbes('_framework/dotnet.native.wasm')]).toEqual([
      '_framework/dotnet.native.wasm',
    ]);
  });

  it('expands multi-dot names that lack a known terminal suffix', () => {
    expect([...new ExtensionProbes('_framework/blazor.webassembly')]).toEqual(
      BARE_EXPANSION.map((p) => p.replace(/^bare/, '_framework/blazor.webassembly')),
    );
  });

  it('does not expand when the multi-dot name already has a probe suffix', () => {
    expect([...new ExtensionProbes('_framework/blazor.webassembly.js')]).toEqual([
      '_framework/blazor.webassembly.js',
    ]);
  });

  it('expands an extensionless source into [bare, ...<bare>.<ext>, ...<bare>/index.<ext>]', () => {
    expect([...new ExtensionProbes('bare')]).toEqual(BARE_EXPANSION);
  });
});
