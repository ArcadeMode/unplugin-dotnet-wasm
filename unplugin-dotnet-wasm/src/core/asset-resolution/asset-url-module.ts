export function buildLiteralPathExportModule(path: string): string {
  return `export default ${JSON.stringify(path)};`;
}

/**
 * re-import the real asset and resolve it to a URL relative to the proxy module.
 */
export function buildNewUrlAssetProxyModule(innerSpecifier: string): string {
  return `import u from ${JSON.stringify(innerSpecifier)};\nexport default new URL(u, import.meta.url).href;`;
}
