import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export class NodeModulesLocator {
  private cache?: string;

  constructor(private readonly root: string) {}

  resolve(): string {
    if (this.cache) return this.cache;
    return this.findNodeModulesDir();
  }

  private findNodeModulesDir(): string {
    let dir = this.root;
    while (true) {
      const candidate = join(dir, 'node_modules');
      if (existsSync(candidate)) return (this.cache = candidate);
      const parent = dirname(dir);
      if (parent === dir) break; // reached the filesystem root
      dir = parent;
    }
    return (this.cache = join(this.root, 'node_modules'));
  }
}
