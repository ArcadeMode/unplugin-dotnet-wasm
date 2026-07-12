import { join } from 'node:path';
import type { NodeModulesLocator } from './node-modules-locator';

/**
 * A pure, no-IO builder for one generated package. Owns the subpath→file layout,
 * the export-key mapping, and the package.json content — but performs no
 * filesystem writes itself.
 */
export class ShimPackage {
  public readonly dir: string;
  private readonly exports: Record<string, { types: string }> = {};

  constructor(locator: NodeModulesLocator, private readonly pkgName: string) {
    this.dir = join(locator.resolve(), pkgName);
  }

  /** Absolute and package-relative output path for an entry's subpath. */
  fileFor(subpath: string): { relFile: string; absFile: string } {
    const relFile = subpath ? `${subpath}/index.d.ts` : 'index.d.ts';
    const absFile = join(this.dir, relFile);
    return { relFile, absFile };
  }

  /** Record an entrypoint in the manifest (export key: subpath ? `./${subpath}` : '.'). */
  addExport(subpath: string, relFile: string): void {
    this.exports[subpath ? `./${subpath}` : '.'] = { types: `./${relFile}` };
  }

  /** The package.json descriptor, or null if no exports were recorded. */
  emit(): { path: string; json: string } | null {
    if (Object.keys(this.exports).length === 0) return null;
    const path = join(this.dir, 'package.json');
    const json = JSON.stringify(
      { name: this.pkgName, version: '0.0.0', private: true, exports: this.exports },
      null,
      2,
    );
    return { path, json };
  }
}
