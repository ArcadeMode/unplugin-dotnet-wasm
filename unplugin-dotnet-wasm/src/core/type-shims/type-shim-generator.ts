import { existsSync } from 'node:fs';
import type { AssetResolver } from '../asset-resolution/asset-resolver';
import type { Logger } from '../logger';
import { toPosixPath } from '../path-utils';
import type { SourceFileChangeTracker } from './source-file-change-tracker';
import type { TsDefinitionEmitter } from './ts-definition-emitter';
import { IdempotentFileWriter } from './idempotent-file-writer';
import { NodeModulesLocator } from './node-modules-locator';
import { ShimPackage } from './shim-package';

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
  private readonly written = new Set<string>();
  private locator: NodeModulesLocator;
  private writer: IdempotentFileWriter;

  constructor(
    private readonly root: string,
    private readonly resolver: AssetResolver,
    private readonly logger: Logger,
    private readonly changeTracker: SourceFileChangeTracker,
    private readonly emitter: TsDefinitionEmitter,
  ) {
    this.locator = new NodeModulesLocator(root);
    this.writer = new IdempotentFileWriter();
  }

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
    const pkg = new ShimPackage(this.locator, pkgName);
    try {
      for (const entry of entries) {
        const { relFile, absFile } = pkg.fileFor(entry.subpath);
        // Check for source changes; record mtime regardless of outcome.
        const changed = await this.changeTracker.hasChanged(entry.physicalPath);
        // Skip emit if the source hasn't changed and the output exists;
        // still record the export so package.json stays complete.
        if (!changed && existsSync(absFile)) {
          pkg.addExport(entry.subpath, relFile);
          continue;
        }
        const dts = this.emit(entry);
        if (dts === null) continue;
        await this.writer.write(absFile, dts);
        pkg.addExport(entry.subpath, relFile);
      }
      const manifest = pkg.emit();
      if (manifest === null) return;
      await this.writer.write(manifest.path, manifest.json);
      this.written.add(pkg.dir);
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

}
