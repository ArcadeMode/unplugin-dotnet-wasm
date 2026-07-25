import { pathToFileURL } from 'node:url';

/** 
 * Serve-node: bake an absolute file:// URL literal to the live physical asset. 
 */
export function buildFileUrlModule(physicalPath: string): string {
  return `export default ${JSON.stringify(pathToFileURL(physicalPath).href)};`;
}

/** 
 * Serve-browser: the page origin + connect middleware resolves /_framework/<name>. 
 */
export function buildOriginPathModule(name: string): string {
  return `export default ${JSON.stringify('/_framework/' + name)};`;
}

/**
 * Build proxy for bundlers without a native file-URL: re-import the real asset and resolve it to a URL relative to the proxy module.
 */
export function buildImportProxyModule(innerSpecifier: string): string {
  return `import u from ${JSON.stringify(innerSpecifier)};\nexport default new URL(u, import.meta.url).href;`;
}
