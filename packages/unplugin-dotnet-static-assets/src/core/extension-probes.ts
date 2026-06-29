import { hasExtension } from './path-utils.js';

/**
 * Iterable expansion of a bundler specifier into candidate virtual paths,
 * in priority order. Subclass to alter the set/order; for example, mapping
 * a `.js` import onto a sibling `.ts` source.
 */
export class ExtensionProbes implements Iterable<string> {
  constructor(private readonly source: string) {}

  *[Symbol.iterator](): IterableIterator<string> {
    yield this.source;
    if (hasExtension(this.source)) return;
    for (const ext of EXTENSION_PROBE_ORDER) yield `${this.source}${ext}`;
    for (const ext of EXTENSION_PROBE_ORDER) yield `${this.source}/index${ext}`;
  }
}
const EXTENSION_PROBE_ORDER = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
] as const;
