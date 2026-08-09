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

  fileFor(subpath: string): { relFile: string; absFile: string } {
    const relFile = subpath ? `${subpath}/index.d.ts` : `index.d.ts`;
    const absFile = join(this.dir, relFile);
    return { relFile, absFile };
  }

  addExport(subpath: string, relFile: string): void {
    this.exports[subpath ? `./${subpath}` : '.'] = { types: `./${relFile}` };
  }

  emitPackageJson(): { path: string; json: string } | null {
    const keys = Object.keys(this.exports);
    if (keys.length === 0) return null;
    const exports = Object.fromEntries(keys.sort().map((k) => [k, this.exports[k]!]));
    const path = join(this.dir, 'package.json');
    const json = JSON.stringify(
      { name: this.pkgName, version: '0.0.0', private: true, exports },
      null,
      2,
    );
    return { path, json };
  }
}
