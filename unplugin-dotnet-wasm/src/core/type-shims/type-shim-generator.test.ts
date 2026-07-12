import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AssetResolver } from '../asset-resolution/asset-resolver';
import type { SourceFileChangeTracker } from './source-file-change-tracker';
import type { TsDefinitionEmitter } from './ts-definition-emitter';
import type { TypeEntry } from './type-entry';
import type { Logger } from '../logger';
import { TypeShimGenerator } from './type-shim-generator';

function createLogger(): Logger {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
}

/** Fake resolver: `routes()` yields the given routes; `resolve()` maps them (missing → null). */
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
  impl: (entry: TypeEntry) => string | null,
): TsDefinitionEmitter & { emit: ReturnType<typeof vi.fn> } {
  return { emit: vi.fn(impl) } as unknown as TsDefinitionEmitter & {
    emit: ReturnType<typeof vi.fn>;
  };
}

/** A temp root and its (not-yet-created) node_modules dir — where the generator writes. */
function tempRoot(): { root: string; nm: string } {
  const root = mkdtempSync(join(tmpdir(), 'gen-'));
  return { root, nm: join(root, 'node_modules') };
}

describe('TypeShimGenerator.generate', () => {
  it('filters non-TS/unresolvable routes and groups the rest by package', async () => {
    const { root, nm } = tempRoot();
    const resolver = createResolver(
      ['typeshim.ts', '_framework/dotnet.d.ts', 'app.css', 'orphan.ts'],
      {
        'typeshim.ts': '/src/typeshim.ts',
        '_framework/dotnet.d.ts': '/src/dotnet.d.ts',
        'app.css': '/src/app.css',
        'orphan.ts': null, // resolves to nothing → skipped
      },
    );
    const emitter = createEmitter((e) => `// dts:${e.pkgName}/${e.subpath}\n`);
    const generator = new TypeShimGenerator(
      root,
      resolver,
      createTracker(true),
      emitter,
      createLogger(),
    );

    await generator.generate();

    // typeshim package (root entrypoint)
    expect(readFileSync(join(nm, 'typeshim', 'index.d.ts'), 'utf8')).toBe('// dts:typeshim/\n');
    const typeshimPkg = JSON.parse(readFileSync(join(nm, 'typeshim', 'package.json'), 'utf8'));
    expect(typeshimPkg.exports).toEqual({ '.': { types: './index.d.ts' } });

    // _framework package (subpath entrypoint)
    expect(readFileSync(join(nm, '_framework', 'dotnet', 'index.d.ts'), 'utf8')).toBe(
      '// dts:_framework/dotnet\n',
    );
    const frameworkPkg = JSON.parse(readFileSync(join(nm, '_framework', 'package.json'), 'utf8'));
    expect(frameworkPkg.exports).toEqual({ './dotnet': { types: './dotnet/index.d.ts' } });

    // Non-TS route and the unresolvable route produced no packages.
    expect(existsSync(join(nm, 'app'))).toBe(false);
    expect(existsSync(join(nm, 'orphan'))).toBe(false);
  });

  it('skips emit for unchanged existing files but keeps the export', async () => {
    const { root, nm } = tempRoot();
    // Pre-existing generated file on disk.
    mkdirSync(join(nm, 'typeshim'), { recursive: true });
    writeFileSync(join(nm, 'typeshim', 'index.d.ts'), '// stale but valid\n');

    const emitter = createEmitter(() => '// freshly emitted\n');
    const generator = new TypeShimGenerator(
      root,
      createResolver(['typeshim.ts'], { 'typeshim.ts': '/src/typeshim.ts' }),
      createTracker(false), // unchanged
      emitter,
      createLogger(),
    );

    await generator.generate();

    expect(emitter.emit).not.toHaveBeenCalled();
    // File left untouched...
    expect(readFileSync(join(nm, 'typeshim', 'index.d.ts'), 'utf8')).toBe('// stale but valid\n');
    // ...but the export is still recorded in the manifest.
    const pkg = JSON.parse(readFileSync(join(nm, 'typeshim', 'package.json'), 'utf8'));
    expect(pkg.exports).toEqual({ '.': { types: './index.d.ts' } });
  });

  it('skips an entry whose emit returns null and writes no manifest for an empty package', async () => {
    const { root, nm } = tempRoot();
    const generator = new TypeShimGenerator(
      root,
      createResolver(['typeshim.ts'], { 'typeshim.ts': '/src/typeshim.ts' }),
      createTracker(true),
      createEmitter(() => null), // emit skipped
      createLogger(),
    );

    await generator.generate();

    expect(existsSync(join(nm, 'typeshim', 'index.d.ts'))).toBe(false);
    expect(existsSync(join(nm, 'typeshim', 'package.json'))).toBe(false);
  });

  it('catches a throwing collaborator and warns instead of rejecting', async () => {
    const { root } = tempRoot();
    const logger = createLogger();
    const generator = new TypeShimGenerator(
      root,
      createResolver(['typeshim.ts'], { 'typeshim.ts': '/src/typeshim.ts' }),
      createTracker(true),
      createEmitter(() => {
        throw new Error('boom');
      }),
      logger,
    );

    await expect(generator.generate()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('typeshim'));
  });
});
