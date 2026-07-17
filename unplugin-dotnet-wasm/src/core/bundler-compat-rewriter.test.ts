import { describe, it, expect } from 'vitest';
import { BundlerCompatRewriter, type BundlerFramework } from './bundler-compat-rewriter';

describe('BundlerCompatRewriter - vite', () => {
  const rewriter = new BundlerCompatRewriter('vite');

  it('inserts /* @vite-ignore */ before import() argument', () => {
    expect(rewriter.rewrite(`import("./foo.js")`))
      .toBe(`import(/* @vite-ignore */ "./foo.js")`);
  });

  it('replaces existing comments on import()', () => {
    expect(rewriter.rewrite(`import(/* webpackIgnore: true */ "./foo.js")`))
      .toBe(`import(/* @vite-ignore */ "./foo.js")`);
  });

  it('inserts /* @vite-ignore */ before new URL() argument', () => {
    expect(rewriter.rewrite(`new URL("./foo.wasm", import.meta.url)`))
      .toBe(`new URL(/* @vite-ignore */ "./foo.wasm", import.meta.url)`);
  });

  it('rewrites all import() calls in a single source', () => {
    const input = [`import("./a.js");`, `import("./b.js");`].join('\n');
    const result = rewriter.rewrite(input);
    expect(result?.match(/import\(\/\* @vite-ignore \*\//g)).toHaveLength(2);
  });

  it('returns null when nothing to change', () => {
    expect(rewriter.rewrite('const x = 1;')).toBeNull();
  });
});

describe('BundlerCompatRewriter - webpack / rspack / rsbuild', () => {
  for (const fw of ['webpack', 'rspack', 'rsbuild'] as BundlerFramework[]) {
    describe(fw, () => {
      const rewriter = new BundlerCompatRewriter(fw);

      it('inserts /* webpackIgnore: true */ on import()', () => {
        expect(rewriter.rewrite(`import("./foo.js")`))
          .toBe(`import(/* webpackIgnore: true */ "./foo.js")`);
      });

      it('does NOT rewrite new URL() (handled by webpackJsParserRule instead)', () => {
        expect(rewriter.rewrite(`new URL("./foo.wasm", import.meta.url)`)).toBeNull();
      });

      it('replaces existing comments on import()', () => {
        expect(rewriter.rewrite(`import(/* @vite-ignore */ "./foo.js")`))
          .toBe(`import(/* webpackIgnore: true */ "./foo.js")`);
      });
    });
  }
});

describe('BundlerCompatRewriter - farm', () => {
  const rewriter = new BundlerCompatRewriter('farm');

  it('inserts /* $farm-ignore */ on import()', () => {
    expect(rewriter.rewrite(`import("./foo.js")`))
      .toBe(`import(/* $farm-ignore */ "./foo.js")`);
  });

  it('inserts /* $farm-ignore */ on new URL()', () => {
    expect(rewriter.rewrite(`new URL("./foo.wasm", import.meta.url)`))
      .toBe(`new URL(/* $farm-ignore */ "./foo.wasm", import.meta.url)`);
  });

  it('replaces existing comments on import()', () => {
    expect(rewriter.rewrite(`import(/* webpackIgnore: true */ "./foo.js")`))
      .toBe(`import(/* $farm-ignore */ "./foo.js")`);
  });
});

describe('BundlerCompatRewriter - rollup / rolldown / esbuild', () => {
  for (const fw of ['rollup', 'rolldown', 'esbuild'] as BundlerFramework[]) {
    it(`${fw}: returns null (no pragma, no transforms apply)`, () => {
      const rewriter = new BundlerCompatRewriter(fw);
      expect(rewriter.rewrite(`import("process");`)).toBeNull();
      expect(rewriter.rewrite(`new URL("./foo.wasm", import.meta.url)`)).toBeNull();
    });
  }
});

describe('BundlerCompatRewriter - bun', () => {
  const rewriter = new BundlerCompatRewriter('bun');

  it('wraps double-quoted Node built-in in comma expression', () => {
    expect(rewriter.rewrite(`import("module")`)).toBe(`import((0,"module"))`);
  });

  it('wraps single-quoted Node built-in in comma expression', () => {
    expect(rewriter.rewrite(`import('fs')`)).toBe(`import((0,'fs'))`);
  });

  it('wraps all DOTNET_NODE_BUILTINS', () => {
    const builtins = ['module', 'process', 'fs', 'path', 'url', 'worker_threads'];
    for (const b of builtins) {
      expect(rewriter.rewrite(`import("${b}")`)).toBe(`import((0,"${b}"))`);
    }
  });

  it('does not touch non-builtin imports', () => {
    expect(rewriter.rewrite(`import("./foo.js")`)).toBeNull();
  });
});

describe('BundlerCompatRewriter - idempotency', () => {
  for (const fw of ['vite', 'webpack', 'farm'] as BundlerFramework[]) {
    it(`${fw}: second rewrite() on the output returns null`, () => {
      const rewriter = new BundlerCompatRewriter(fw);
      const first = rewriter.rewrite(`import("./foo.js")`);
      expect(first).not.toBeNull();
      expect(rewriter.rewrite(first!)).toBeNull();
    });
  }
});
