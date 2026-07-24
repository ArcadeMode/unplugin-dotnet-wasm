import { pathToFileURL } from 'node:url';

/** Serve-node: bake an absolute file:// URL literal to the live physical asset. */
export function buildFileUrlModule(physicalPath: string): string {
  return `export default ${JSON.stringify(pathToFileURL(physicalPath).href)};`;
}

/** Serve-browser: the page origin + connect middleware resolves /_framework/<name>. */
export function buildOriginPathModule(name: string): string {
  return `export default ${JSON.stringify('/_framework/' + name)};`;
}

/**
 * Build proxy for bundlers without a native file-URL emitter (esbuild/bun/webpack): re-import
 * the real asset (hits the bundler's `file` loader → chunk-relative path), then resolve it
 * against import.meta.url so the exported value is a portable URL string (http(s): in browser,
 * file: in Node). Replaces the consumer-side withResourceLoader shim.
 */
export function buildImportMetaUrlModule(innerSpecifier: string): string {
  return `import u from ${JSON.stringify(innerSpecifier)};\nexport default new URL(u, import.meta.url).href;`;
}
