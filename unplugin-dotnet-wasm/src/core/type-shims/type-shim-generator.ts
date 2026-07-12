import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AssetResolver } from '../asset-resolution/asset-resolver';
import type { Logger } from '../logger';
import { toPosixPath } from '../path-utils';
import type { SourceFileChangeTracker } from './source-file-change-tracker';
import type { TsDefinitionEmitter } from './ts-definition-emitter';

/** A single virtual type entrypoint discovered from the manifest. */
interface TypeEntry {
  pkgName: string;
  subpath: string;
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
 * tsserver/`tsc` resolve the plugin's virtual imports with full types.
 */
export class TypeShimGenerator {
  private nodeModulesBase?: string;
  private readonly written = new Set<string>();

  constructor(
    private readonly root: string,
    private readonly resolver: AssetResolver,
    private readonly logger: Logger,
    private readonly changeTracker: SourceFileChangeTracker,
    private readonly emitter: TsDefinitionEmitter,
  ) {}

  /** Discover → emit → write. Idempotent; safe to call on every build. */
  async generate(): Promise<void> {
    const groups = this.discover();
    if (groups.size === 0) return;

    for (const [pkgName, entries] of groups) {
      await this.writePackage(pkgName, entries);
    }
  }

  /** Enumerate TS-declaration entrypoints from the resolver, grouped by package. */
  private discover(): Map<string, TypeEntry[]> {
    const groups = new Map<string, TypeEntry[]>();
    for (const route of this.resolver.routes()) {
      const kind = typeKind(route);
      if (!kind) continue;
      const physicalPath = this.resolver.resolve(route);
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
  ): Promise<void> {
    const pkgDir = join(this.resolveNodeModulesBase(), pkgName);
    try {
      const exports: Record<string, { types: string }> = {};
      for (const entry of entries) {
        // Check for source changes; record mtime regardless of outcome.
        const changed = await this.changeTracker.hasChanged(entry.physicalPath);
        const relFile = entry.subpath ? `${entry.subpath}/index.d.ts` : 'index.d.ts';
        const absFile = join(pkgDir, relFile);

        // Skip emit if the source hasn't changed and the output file exists.
        // Still add the entry to exports so the package.json stays complete.
        if (!changed && existsSync(absFile)) {
          exports[entry.subpath ? `./${entry.subpath}` : '.'] = { types: `./${relFile}` };
          continue;
        }

        // Emit (or re-emit if changed).
        const dts = this.emit(entry);
        if (dts === null) continue;

        // Skip write if the file exists and its content matches the newly produced string.
        let shouldWrite = true;
        if (existsSync(absFile)) {
          try {
            const existing = await readFile(absFile, 'utf8');
            if (existing === dts) shouldWrite = false;
          } catch {
            // Read failed → write to be safe (ensures a corrupted file self-heals).
            shouldWrite = true;
          }
        }

        if (shouldWrite) {
          await mkdir(dirname(absFile), { recursive: true });
          await writeFile(absFile, dts, 'utf8');
        }

        exports[entry.subpath ? `./${entry.subpath}` : '.'] = { types: `./${relFile}` };
      }
      if (Object.keys(exports).length === 0) return;

      // Skip package.json write if it exists and matches the produced JSON.
      const pkgJsonPath = join(pkgDir, 'package.json');
      const pkgJsonContent = JSON.stringify(
        { name: pkgName, version: '0.0.0', private: true, exports },
        null,
        2,
      );
      let shouldWritePackageJson = true;
      if (existsSync(pkgJsonPath)) {
        try {
          const existing = await readFile(pkgJsonPath, 'utf8');
          if (existing === pkgJsonContent) shouldWritePackageJson = false;
        } catch {
          // Read failed → write to be safe.
          shouldWritePackageJson = true;
        }
      }

      if (shouldWritePackageJson) {
        await writeFile(pkgJsonPath, pkgJsonContent, 'utf8');
      }

      this.written.add(pkgDir);
    } catch (err) {
      this.logger.warn(`type-shims: write failed for "${pkgName}" (${String(err)}); skipping`);
    }
  }

  /** Produce the `.d.ts` text for one entrypoint, or `null` to skip it. */
  private emit(entry: TypeEntry): string | null {
    if (entry.kind === 'dts') {
      // Re-export the existing `.d.ts` by absolute, extensionless, POSIX specifier
      // (backslashes would be parsed as string escapes). `export *` forwards named
      // types/values but not `default` — appending that is Aux A.
      const specifier = toPosixPath(entry.physicalPath.replace(TS_ROUTE, ''));
      return `export * from '${specifier}';\n`;
    }

    return this.emitter.emit(entry.physicalPath);
  }

  /**
   * The `node_modules` directory to write packages into. Local-first: use
   * `<root>/node_modules` when it exists, else walk up to the nearest ancestor
   * that has one (covers hoisted monorepos), else fall back to creating one under
   * the root. Node resolves up the tree, so any ancestor on the entry files' path
   * makes the package resolvable. Cached after first resolution.
   */
  private resolveNodeModulesBase(): string {
    if (this.nodeModulesBase) return this.nodeModulesBase;
    let dir = this.root;
    for (;;) {
      const candidate = join(dir, 'node_modules');
      if (existsSync(candidate)) return (this.nodeModulesBase = candidate);
      const parent = dirname(dir);
      if (parent === dir) break; // reached the filesystem root
      dir = parent;
    }
    return (this.nodeModulesBase = join(this.root, 'node_modules'));
  }

}
