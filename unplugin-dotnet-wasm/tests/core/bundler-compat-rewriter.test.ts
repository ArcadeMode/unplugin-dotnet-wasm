import { describe, it, expect } from 'vitest';
import { BundlerCompatRewriter, type BundlerFramework } from '@src/core/bundler-compat-rewriter';

describe('BundlerCompatRewriter - vite', () => {
  const rewriter = new BundlerCompatRewriter('vite');

  it('inserts /* @vite-ignore */ on expression import()', () => {
    expect(rewriter.rewrite(`import(foo)`)).toBe(`import(/* @vite-ignore */ foo)`);
  });

  it('does not rewrite string-literal import()', () => {
    expect(rewriter.rewrite(`import("./foo.js")`)).toBeNull();
  });

  it('replaces existing comments on import()', () => {
    expect(rewriter.rewrite(`import(/* webpackIgnore: true */ "./foo.js")`)).toBe(
      `import(/* @vite-ignore */ "./foo.js")`,
    );
  });

  it('inserts /* @vite-ignore */ before new URL() argument', () => {
    expect(rewriter.rewrite(`new URL("./foo.wasm", import.meta.url)`)).toBe(
      `new URL(/* @vite-ignore */ "./foo.wasm", import.meta.url)`,
    );
  });

  it('rewrites all expression import() calls in a single source', () => {
    const input = [`import(a);`, `import(b);`].join('\n');
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

      it('inserts /* webpackIgnore: true */ on expression import()', () => {
        expect(rewriter.rewrite(`import(foo)`)).toBe(`import(/* webpackIgnore: true */ foo)`);
      });

      it('does not rewrite string-literal import()', () => {
        expect(rewriter.rewrite(`import("./foo.js")`)).toBeNull();
      });

      it('does NOT rewrite new URL() (handled by webpackJsParserRule instead)', () => {
        expect(rewriter.rewrite(`new URL("./foo.wasm", import.meta.url)`)).toBeNull();
      });

      it('replaces existing comments on import()', () => {
        expect(rewriter.rewrite(`import(/* @vite-ignore */ "./foo.js")`)).toBe(
          `import(/* webpackIgnore: true */ "./foo.js")`,
        );
      });
    });
  }
});

describe('BundlerCompatRewriter - farm', () => {
  const rewriter = new BundlerCompatRewriter('farm');

  it('inserts /* $farm-ignore */ on expression import()', () => {
    expect(rewriter.rewrite(`import(foo)`)).toBe(`import(/* $farm-ignore */ foo)`);
  });

  it('does not rewrite string-literal import()', () => {
    expect(rewriter.rewrite(`import("./foo.js")`)).toBeNull();
  });

  it('inserts /* $farm-ignore */ on new URL()', () => {
    expect(rewriter.rewrite(`new URL("./foo.wasm", import.meta.url)`)).toBe(
      `new URL(/* $farm-ignore */ "./foo.wasm", import.meta.url)`,
    );
  });

  it('replaces existing comments on import()', () => {
    expect(rewriter.rewrite(`import(/* webpackIgnore: true */ "./foo.js")`)).toBe(
      `import(/* $farm-ignore */ "./foo.js")`,
    );
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
      const first = rewriter.rewrite(`import(foo)`);
      expect(first).not.toBeNull();
      expect(rewriter.rewrite(first!)).toBeNull();
    });
  }
});

describe('BundlerCompatRewriter - pins the .NET SDK JS shapes the rewriter depends on', () => {
  const rewriter = new BundlerCompatRewriter('vite');

  it('rewrites expression import() (dotnet.js loadBootResource / library initializers)', () => {
    expect(rewriter.rewrite(`import(I(n))`)).toBe(`import(/* @vite-ignore */ I(n))`);
    expect(rewriter.rewrite(`import(ce(o,"manifest"))`)).toBe(
      `import(/* @vite-ignore */ ce(o,"manifest"))`,
    );
  });

  it('leaves blazor.webassembly.js import("./dotnet.js") bundler-visible', () => {
    expect(rewriter.rewrite(`return await import("./dotnet.js")`)).toBeNull();
  });

  it('rewrites blazor.webassembly.js expression import() and keeps the string literal', () => {
    const code = `await import(e); return await import("./dotnet.js")`;
    expect(rewriter.rewrite(code)).toBe(
      `await import(/* @vite-ignore */ e); return await import("./dotnet.js")`,
    );
  });

  it('replaces SDK webpackIgnore on string-literal Node builtins', () => {
    expect(rewriter.rewrite(`import(/*! webpackIgnore: true */"process")`)).toBe(
      `import(/* @vite-ignore */ "process")`,
    );
  });

  it('rewrites new URL() with single space between new and URL', () => {
    const code = `new URL("x", import.meta.url)`;
    const result = rewriter.rewrite(code);
    expect(result).toContain(`new URL(/* @vite-ignore */ "x", import.meta.url)`);
  });
});
