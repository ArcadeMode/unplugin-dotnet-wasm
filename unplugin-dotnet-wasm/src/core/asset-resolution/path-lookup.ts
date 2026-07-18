import type { NormalizedPath } from '../path-utils';

export class DuplicatePathError extends Error {
  readonly key: string;
  constructor(key: string) {
    super(`Duplicate path after normalisation: "${key}"`);
    this.name = 'DuplicatePathError';
    this.key = key;
  }
}

/** Case-folded, NormalizedPath-keyed lookup map. Abstract — subclass per value type. */
export abstract class PathLookup<TValue> {
  private readonly map = new Map<string, TValue>();

  /** Insert a path→value. @throws {DuplicatePathError} if the path's key is already present. */
  set(p: NormalizedPath, value: TValue): void {
    if (this.map.has(p.lookupKey)) throw new DuplicatePathError(p.lookupKey);
    this.map.set(p.lookupKey, value);
  }
  get(p: NormalizedPath): TValue | undefined { return this.map.get(p.lookupKey); }
  has(p: NormalizedPath): boolean { return this.map.has(p.lookupKey); }
  get size(): number { return this.map.size; }
  values(): IterableIterator<TValue> { return this.map.values(); }
  /** Iterate [key, value] entries. The key is the case-folded lookupKey string. */
  [Symbol.iterator](): IterableIterator<[string, TValue]> { return this.map[Symbol.iterator](); }
}
