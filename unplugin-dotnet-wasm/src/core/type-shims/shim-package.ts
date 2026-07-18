import { join } from 'node:path';
import type { NodeModulesLocator } from './node-modules-locator';

export class ShimPackage {
  public readonly dir: string;
  private readonly exports: Record<string, { types: string }> = {};

  constructor(
    locator: NodeModulesLocator,
    private readonly pkgName: string,
  ) {
    this.dir = join(locator.resolve(), pkgName);
  }

  /** Absolute and package-relative output path for a subpath. */
  fileFor(subpath: string): { relFile: string; absFile: string } {
    const relFile = subpath ? `${subpath}/index.d.ts` : `index.d.ts`;
    const absFile = join(this.dir, relFile);
    return { relFile, absFile };
  }

  addExport(subpath: string, relFile: string): void {
    this.exports[subpath ? `./${subpath}` : '.'] = { types: `./${relFile}` };
  }

  emitPackageJson(): { path: string; json: string } | null {
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
