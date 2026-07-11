import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { AssetResolver } from '../asset-resolution/asset-resolver';
import type { Logger } from '../logger';

export interface TypeShimGeneratorDeps {
  /** Consumer root; generated packages land in `<root>/node_modules`. */
  root: string;
  /** Sole manifest dependency — owns route enumeration and physical resolution. */
  resolver: AssetResolver;
  logger: Logger;
}

/** A single virtual type entrypoint discovered from the manifest. */
interface TypeEntry {
  /** First path segment of the specifier → fake package name (`typeshim`, `_framework`). */
  pkgName: string;
  /** Remaining path after the package segment; `''` for a root entrypoint. */
  subpath: string;
  /** Physical `.ts`/`.d.ts` file on disk (fingerprints already resolved). */
  physicalPath: string;
  kind: 'ts' | 'dts';
}

const TS_ROUTE = /\.(d\.ts|ts|mts|cts)$/;

/** Classify a route by its TypeScript extension, or `null` if it is not one. */
function typeKind(route: string): TypeEntry['kind'] | null {
  if (/\.d\.ts$/.test(route)) return 'dts';
  if (TS_ROUTE.test(route)) return 'ts';
  return null;
}

/** Split a route into `{ pkgName, subpath }` and strip its TS extension. */
function toEntry(route: string, physicalPath: string, kind: TypeEntry['kind']): TypeEntry {
  const specifier = route.replace(TS_ROUTE, '');
  const slash = specifier.indexOf('/');
  const pkgName = slash === -1 ? specifier : specifier.slice(0, slash);
  const subpath = slash === -1 ? '' : specifier.slice(slash + 1);
  return { pkgName, subpath, physicalPath, kind };
}

/**
 * Generates "magic" type-only packages under the consumer's `node_modules` so
 * tsserver/`tsc` resolve the plugin's virtual imports with full types, without
 * any tsconfig changes. Stateful: instantiated once per build, holds the loaded
 * `typescript` module and the set of packages written this session (basis for
 * idempotent rewrites, stale pruning, and dev-session live refresh later).
 */
export class TypeShimGenerator {
  private ts?: typeof import('typescript');
  private tsUnavailable = false;
  private readonly written = new Set<string>();

  constructor(private readonly deps: TypeShimGeneratorDeps) {}

  /** Discover → emit → write. Idempotent; safe to call on every build. */
  async generate(): Promise<void> {
    const groups = this.discover();
    if (groups.size === 0) return;

    const ts = await this.loadTs();
    if (!ts) return;

    for (const [pkgName, entries] of groups) {
      await this.writePackage(pkgName, entries, ts);
    }
  }

  /** Enumerate TS-declaration entrypoints from the resolver, grouped by package. */
  private discover(): Map<string, TypeEntry[]> {
    const groups = new Map<string, TypeEntry[]>();
    for (const route of this.deps.resolver.routes()) {
      const kind = typeKind(route);
      if (!kind) continue;
      const physicalPath = this.deps.resolver.resolve(route);
      if (physicalPath === null) continue;
      const entry = toEntry(route, physicalPath, kind);
      const group = groups.get(entry.pkgName);
      if (group) group.push(entry);
      else groups.set(entry.pkgName, [entry]);
    }
    return groups;
  }

  /** Write one fake package: emit each entrypoint's `.d.ts` and a `package.json`. */
  private async writePackage(
    pkgName: string,
    entries: TypeEntry[],
    ts: typeof import('typescript'),
  ): Promise<void> {
    const pkgDir = join(this.deps.root, 'node_modules', pkgName);
    try {
      await mkdir(pkgDir, { recursive: true });

      const exports: Record<string, { types: string }> = {};
      for (const entry of entries) {
        const dts = this.emit(entry, ts);
        if (dts === null) continue;
        const relFile = entry.subpath ? `${entry.subpath}/index.d.ts` : 'index.d.ts';
        const absFile = join(pkgDir, relFile);
        await mkdir(dirname(absFile), { recursive: true });
        await writeFile(absFile, dts, 'utf8');
        exports[entry.subpath ? `./${entry.subpath}` : '.'] = { types: `./${relFile}` };
      }
      if (Object.keys(exports).length === 0) return;

      await writeFile(
        join(pkgDir, 'package.json'),
        JSON.stringify({ name: pkgName, version: '0.0.0', private: true, exports }, null, 2),
        'utf8',
      );
      this.written.add(pkgDir);
    } catch (err) {
      this.deps.logger.warn(`type-shims: write failed for "${pkgName}" (${String(err)}); skipping`);
    }
  }

  /** Produce the `.d.ts` text for one entrypoint, or `null` to skip it. */
  private emit(entry: TypeEntry, ts: typeof import('typescript')): string | null {
    if (entry.kind === 'dts') {
      // Post-MVP: re-export the existing `.d.ts` (with `export { default }` when present).
      // The .NET SDK does not emit `dotnet.d.ts` yet, so this path is currently unreached.
      const specifier = entry.physicalPath.replace(TS_ROUTE, '');
      return `export * from '${specifier}';\n`;
    }

    // Full type-directed declaration emit via a single-file Program. Unlike
    // `transpileDeclaration`, this does not require `--isolatedDeclarations`
    // conformance, so it handles ordinary SDK-generated TypeScript.
    const options: import('typescript').CompilerOptions = {
      declaration: true,
      emitDeclarationOnly: true,
      skipLibCheck: true,
      strict: false,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    };
    const host = ts.createCompilerHost(options, /* setParentNodes */ true);
    let dts: string | undefined;
    host.writeFile = (fileName, text) => {
      if (fileName.endsWith('.d.ts')) dts = text;
    };
    const program = ts.createProgram([entry.physicalPath], options, host);
    program.emit(undefined, undefined, undefined, /* emitOnlyDtsFiles */ true);

    if (dts === undefined) {
      this.deps.logger.warn(
        `type-shims: declaration emit produced no output for "${entry.physicalPath}"; skipping`,
      );
      return null;
    }
    return dts;
  }

  /**
   * Lazily load `typescript`, resolved from the **consumer's** `node_modules`
   * so the emitted `.d.ts` matches their language version. Warns once and stays
   * disabled if it is not installed there.
   */
  private async loadTs(): Promise<typeof import('typescript') | undefined> {
    if (this.ts) return this.ts;
    if (this.tsUnavailable) return undefined;

    // A require anchored in the consumer root; the base file need not exist.
    const consumerRequire = createRequire(join(this.deps.root, '__tsresolve__.js'));
    try {
      const entry = consumerRequire.resolve('typescript');
      const mod = (await import(pathToFileURL(entry).href)) as
        | typeof import('typescript')
        | { default: typeof import('typescript') };
      this.ts = 'default' in mod ? mod.default : mod;
      return this.ts;
    } catch {
      this.tsUnavailable = true;
      this.deps.logger.warn(
        'type-shims: typescript not resolvable from the consumer root; skipping type generation',
      );
      return undefined;
    }
  }
}
