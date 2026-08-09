import { BINARY_EXTENSIONS } from '../constants';

export class ExtensionProbes implements Iterable<string> {
  constructor(private readonly source: string) {}

  *[Symbol.iterator](): IterableIterator<string> {
    yield this.source;
    if (hasTerminalSuffix(this.source)) return;
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

function hasTerminalSuffix(posixPath: string): boolean {
  const base = (posixPath.split('/').at(-1) ?? '').toLowerCase();
  for (const ext of BINARY_EXTENSIONS) {
    if (base.endsWith(ext)) return true;
  }
  for (const ext of EXTENSION_PROBE_ORDER) {
    if (base.endsWith(ext)) return true;
  }
  return false;
}
