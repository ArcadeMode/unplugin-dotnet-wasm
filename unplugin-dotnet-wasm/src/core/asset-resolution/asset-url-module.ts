export function buildLiteralPathExportModule(path: string): string {
  return `export default ${JSON.stringify(path)};`;
}

/** `new URL(<expr>, import.meta.url).href`, resolving `expr` against the current module. */
export function newUrlAgainstImportMeta(expr: string): string {
  return `new URL(${expr}, import.meta.url).href`;
}

/**
 * re-import the real asset and resolve it to a URL relative to the proxy module.
 */
export function buildNewUrlAssetProxyModule(innerSpecifier: string): string {
  return `import u from ${JSON.stringify(innerSpecifier)};\nexport default ${newUrlAgainstImportMeta('u')};`;
}

/**
 * re-import the real asset and re-export the bundler-provided URL as-is. Used by
 * webpack/rspack whose `asset/resource` loader already yields a URL resolved
 * against the served publicPath; wrapping it in `new URL(u, import.meta.url)`
 * would rebase it onto the module's on-disk `file://` location (webpack sets
 * `import.meta.url` to the module file), breaking dev-server fetches.
 */
export function buildReexportAssetModule(innerSpecifier: string): string {
  return `import u from ${JSON.stringify(innerSpecifier)};\nexport default u;`;
}
