import { cleanMaterialized, shutdownBuildServers } from './clean';

export default async function globalTeardown(): Promise<void> {
  try {
    await shutdownBuildServers();
    cleanMaterialized();
  } catch (err) {
    console.error('[e2e] global teardown failed:', err);
  }
}
