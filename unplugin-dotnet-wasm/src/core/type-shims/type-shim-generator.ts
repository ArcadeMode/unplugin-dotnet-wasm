import { existsSync } from 'node:fs';
import type { AssetResolver } from '../asset-resolution/asset-resolver';
import type { Logger } from '../logger';
import type { SourceFileChangeTracker } from './source-file-change-tracker';
import type { TsDefinitionEmitter } from './ts-definition-emitter';
import { IdempotentFileWriter } from './idempotent-file-writer';
import { NodeModulesLocator } from './node-modules-locator';
import { ShimPackage } from './shim-package';
import { TS_ROUTE, TypeEntry } from './type-entry';

/** Classify a route by its TypeScript extension, or `null` if it is not one. */
function typeKind(route: string): TypeEntry['kind'] | null {
  if (/\.d\.ts$/.test(route)) return 'dts';
  if (TS_ROUTE.test(route)) return 'ts';
  return null;
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
    root: string,
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
      const entry = new TypeEntry(route, physicalPath, kind);
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
        const changed = await this.changeTracker.hasChanged(entry.physicalPath);
        if (!changed && existsSync(absFile)) {
          // Ensure package.json stays complete.
          pkg.addExport(entry.subpath, relFile);
          continue;
        }
        const dts = this.emitter.emit(entry);
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

}
