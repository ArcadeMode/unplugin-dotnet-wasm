export const EXTENSION_PROBE_ORDER = [
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

export type ExtensionProbeExt = (typeof EXTENSION_PROBE_ORDER)[number];
