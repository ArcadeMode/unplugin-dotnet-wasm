/**
 * Based on `process.versions.pnp` https://yarnpkg.com/advanced/pnpapi#processversionspnp
 */
export function isYarnPnp(versions: { pnp?: string } = process.versions as { pnp?: string }): boolean {
  return versions.pnp != null;
}
