/** Matches a TypeScript source extension. */
export const TS_ROUTE = /\.(d\.ts|ts|mts|cts)$/;

/** A single virtual type entrypoint discovered from the manifest. */
export class TypeEntry {
  readonly pkgName: string;
  readonly subpath: string;

  constructor(
    route: string,
    readonly physicalPath: string,
    readonly kind: 'ts' | 'dts',
  ) {
    const specifier = route.replace(TS_ROUTE, '');
    const slash = specifier.indexOf('/');
    this.pkgName = slash === -1 ? specifier : specifier.slice(0, slash);
    this.subpath = slash === -1 ? '' : specifier.slice(slash + 1);
  }
}
