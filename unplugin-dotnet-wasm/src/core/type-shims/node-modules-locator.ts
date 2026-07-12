import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Resolve the `node_modules` directory to write packages into. Local-first: use
 * `<root>/node_modules` when it exists, else walk up to the nearest ancestor
 * that has one (covers hoisted monorepos), else fall back to creating one under
 * the root. Node resolves up the tree, so any ancestor on the entry files' path
 * makes the package resolvable. Cached after first resolution.
 */
export class NodeModulesLocator {
  private cache?: string;

  constructor(private readonly root: string) {}

  resolve(): string {
    if (this.cache) return this.cache;
    let dir = this.root;
    for (;;) {
      const candidate = join(dir, 'node_modules');
      if (existsSync(candidate)) return (this.cache = candidate);
      const parent = dirname(dir);
      if (parent === dir) break; // reached the filesystem root
      dir = parent;
    }
    return (this.cache = join(this.root, 'node_modules'));
  }
}
