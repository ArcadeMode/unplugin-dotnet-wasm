import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AssetResolver } from '@src/core/asset-resolution/asset-resolver';
import type { SourceFileChangeTracker } from '@src/core/type-shims/source-file-change-tracker';
import type { TsDefinitionEmitter } from '@src/core/type-shims/ts-definition-emitter';
import type { Logger } from '@src/core/logger';
import { ShimPackageGenerator } from '@src/core/type-shims/shim-package-generator';
import { NodeModulesLocator } from '@src/core/type-shims/node-modules-locator';
import { FileDiscoverer } from '@src/core/type-shims/file-discoverer';

function createLogger(): Logger {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
}

function createResolver(
  routes: string[],
  resolveMap: Record<string, string | null>,
): AssetResolver {
  return {
    routes: () => routes[Symbol.iterator](),
    resolve: (route: string) => (route in resolveMap ? resolveMap[route] : null),
  } as unknown as AssetResolver;
}

function createTracker(changed: boolean): SourceFileChangeTracker {
  return { hasChanged: vi.fn(async () => changed) } as unknown as SourceFileChangeTracker;
}

function createEmitter(
  reExportImpl?: (defFile: string) => string,
  compileImpl?: (sourceFile: string) => string | null,
): TsDefinitionEmitter & {
  forwardDTS: ReturnType<typeof vi.fn>;
  compileToDTS: ReturnType<typeof vi.fn>;
} {
  return {
    forwardDTS: vi.fn(reExportImpl || ((defFile) => `export * from '${defFile.slice(0, -5)}';\n`)),
    compileToDTS: vi.fn(compileImpl || (() => '// compiled\n')),
  } as unknown as TsDefinitionEmitter & {
    forwardDTS: ReturnType<typeof vi.fn>;
    compileToDTS: ReturnType<typeof vi.fn>;
  };
}

function tempRoot(): { root: string; nm: string } {
  const root = mkdtempSync(join(tmpdir(), 'gen-'));
  return { root, nm: join(root, 'node_modules') };
}

function compileCallsFor(emitter: { compileToDTS: ReturnType<typeof vi.fn> }, src: string): number {
  return emitter.compileToDTS.mock.calls.filter((c) => c[0] === src).length;
}

describe('ShimPackageGenerator.generate', () => {
  it('emits bare + suffixed packages for a root .ts and a forwarded nested .d.ts', async () => {
    const { root, nm } = tempRoot();
    const resolver = createResolver(
      ['typeshim.ts', '_framework/dotnet.d.ts', 'app.css', 'orphan.ts'],
      {
        'typeshim.ts': '/src/typeshim.ts',
        '_framework/dotnet.d.ts': '/src/dotnet.d.ts',
        'app.css': '/src/app.css',
        'orphan.ts': null,
      },
    );
    const emitter = createEmitter(
      (defFile) => `export * from '${defFile.slice(0, -5)}';\n`,
      (sourceFile) => `// compiled:${sourceFile}\n`,
    );
    const generator = new ShimPackageGenerator(
      new NodeModulesLocator(root),
      new FileDiscoverer(resolver),
      createTracker(true),
      emitter,
      createLogger(),
    );

    await generator.generate();

    expect(readFileSync(join(nm, 'typeshim', 'index.d.ts'), 'utf8')).toBe(
      '// compiled:/src/typeshim.ts\n',
    );
    expect(JSON.parse(readFileSync(join(nm, 'typeshim', 'package.json'), 'utf8')).exports).toEqual({
      '.': { types: './index.d.ts' },
    });
    expect(readFileSync(join(nm, 'typeshim.ts', 'index.d.ts'), 'utf8')).toBe(
      '// compiled:/src/typeshim.ts\n',
    );
    expect(compileCallsFor(emitter, '/src/typeshim.ts')).toBe(1);

    expect(readFileSync(join(nm, '_framework', 'dotnet', 'index.d.ts'), 'utf8')).toBe(
      "export * from '/src/dotnet';\n",
    );
    expect(
      JSON.parse(readFileSync(join(nm, '_framework', 'package.json'), 'utf8')).exports,
    ).toEqual({
      './dotnet': { types: './dotnet/index.d.ts' },
    });

    expect(existsSync(join(nm, 'app'))).toBe(false);
    expect(existsSync(join(nm, 'orphan'))).toBe(false);
  });

  it('exposes a type-less .js at both bare and suffixed specifiers sharing one file', async () => {
    const { root, nm } = tempRoot();
    const resolver = createResolver(['_framework/blazor.webassembly.js'], {
      '_framework/blazor.webassembly.js': '/dist/_framework/blazor.webassembly.js',
    });
    const emitter = createEmitter(undefined, (src) => `// compiled:${src}\n`);
    const generator = new ShimPackageGenerator(
      new NodeModulesLocator(root),
      new FileDiscoverer(resolver),
      createTracker(true),
      emitter,
      createLogger(),
    );

    await generator.generate();

    expect(emitter.forwardDTS).not.toHaveBeenCalled();
    expect(compileCallsFor(emitter, '/dist/_framework/blazor.webassembly.js')).toBe(1);
    expect(readFileSync(join(nm, '_framework', 'blazor.webassembly', 'index.d.ts'), 'utf8')).toBe(
      '// compiled:/dist/_framework/blazor.webassembly.js\n',
    );
    expect(
      JSON.parse(readFileSync(join(nm, '_framework', 'package.json'), 'utf8')).exports,
    ).toEqual({
      './blazor.webassembly': { types: './blazor.webassembly/index.d.ts' },
      './blazor.webassembly.js': { types: './blazor.webassembly/index.d.ts' },
    });
  });

  it('forwards a .d.ts to both bare and suffixed specifiers (real types win, compiled never)', async () => {
    const { root, nm } = tempRoot();
    const resolver = createResolver(['pkg/foo.js', 'pkg/foo.d.ts'], {
      'pkg/foo.js': '/src/foo.js',
      'pkg/foo.d.ts': '/src/foo.d.ts',
    });
    const emitter = createEmitter((defFile) => `export * from '${defFile.slice(0, -5)}';\n`);
    const generator = new ShimPackageGenerator(
      new NodeModulesLocator(root),
      new FileDiscoverer(resolver),
      createTracker(true),
      emitter,
      createLogger(),
    );

    await generator.generate();

    expect(emitter.compileToDTS).not.toHaveBeenCalled();
    expect(emitter.forwardDTS).toHaveBeenCalledOnce();
    expect(emitter.forwardDTS.mock.calls[0]![0]).toBe('/src/foo.d.ts');
    expect(readFileSync(join(nm, 'pkg', 'foo', 'index.d.ts'), 'utf8')).toBe(
      "export * from '/src/foo';\n",
    );
    expect(JSON.parse(readFileSync(join(nm, 'pkg', 'package.json'), 'utf8')).exports).toEqual({
      './foo': { types: './foo/index.d.ts' },
      './foo.js': { types: './foo/index.d.ts' },
    });
  });

  it('skips emit for an unchanged existing file but keeps the export', async () => {
    const { root, nm } = tempRoot();
    mkdirSync(join(nm, '_framework', 'dotnet'), { recursive: true });
    writeFileSync(
      join(nm, '_framework', '.dotnet-wasm-typeshim'),
      '# Generated by unplugin-dotnet-wasm - provides editor and tsc types for virtual .NET WASM imports.\n',
    );
    writeFileSync(join(nm, '_framework', 'dotnet', 'index.d.ts'), '// stale but valid\n');

    const emitter = createEmitter(() => '// freshly forwarded\n');
    const generator = new ShimPackageGenerator(
      new NodeModulesLocator(root),
      new FileDiscoverer(
        createResolver(['_framework/dotnet.d.ts'], {
          '_framework/dotnet.d.ts': '/src/dotnet.d.ts',
        }),
      ),
      createTracker(false),
      emitter,
      createLogger(),
    );

    await generator.generate();

    expect(emitter.forwardDTS).not.toHaveBeenCalled();
    expect(readFileSync(join(nm, '_framework', 'dotnet', 'index.d.ts'), 'utf8')).toBe(
      '// stale but valid\n',
    );
    expect(
      JSON.parse(readFileSync(join(nm, '_framework', 'package.json'), 'utf8')).exports,
    ).toEqual({
      './dotnet': { types: './dotnet/index.d.ts' },
    });
  });

  it('skips an entry whose compileToDTS returns null and writes no package', async () => {
    const { root, nm } = tempRoot();
    const generator = new ShimPackageGenerator(
      new NodeModulesLocator(root),
      new FileDiscoverer(createResolver(['typeshim.ts'], { 'typeshim.ts': '/src/typeshim.ts' })),
      createTracker(true),
      createEmitter(undefined, () => null),
      createLogger(),
    );

    await generator.generate();

    expect(existsSync(join(nm, 'typeshim'))).toBe(false);
    expect(existsSync(join(nm, 'typeshim.ts'))).toBe(false);
  });

  it('catches a throwing collaborator and warns instead of rejecting', async () => {
    const { root } = tempRoot();
    const logger = createLogger();
    const emitter = createEmitter(() => {
      throw new Error('boom');
    });
    const generator = new ShimPackageGenerator(
      new NodeModulesLocator(root),
      new FileDiscoverer(
        createResolver(['_framework/dotnet.d.ts'], {
          '_framework/dotnet.d.ts': '/src/dotnet.d.ts',
        }),
      ),
      createTracker(true),
      emitter,
      logger,
    );

    await expect(generator.generate()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('_framework'));
  });

  it('detects a foreign package and leaves it untouched, warning instead of clobbering', async () => {
    const { root, nm } = tempRoot();
    mkdirSync(join(nm, '_framework'), { recursive: true });
    const pkgJsonPath = join(nm, '_framework', 'package.json');
    const pkgJsonContent = '{"name":"_framework","version":"9.9.9"}\n';
    writeFileSync(pkgJsonPath, pkgJsonContent);
    const dummyPath = join(nm, '_framework', 'dummy.js');
    const dummyContent = 'module.exports = {};\n';
    writeFileSync(dummyPath, dummyContent);

    const logger = createLogger();
    const generator = new ShimPackageGenerator(
      new NodeModulesLocator(root),
      new FileDiscoverer(
        createResolver(['_framework/dotnet.d.ts'], {
          '_framework/dotnet.d.ts': '/src/dotnet.d.ts',
        }),
      ),
      createTracker(true),
      createEmitter(() => '// generated\n'),
      logger,
    );

    await generator.generate();

    expect(readFileSync(pkgJsonPath, 'utf8')).toBe(pkgJsonContent);
    expect(readFileSync(dummyPath, 'utf8')).toBe(dummyContent);
    expect(existsSync(join(nm, '_framework', 'dotnet', 'index.d.ts'))).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('already exists'));
  });
});
