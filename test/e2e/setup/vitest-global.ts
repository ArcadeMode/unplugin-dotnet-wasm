import { cleanMaterialized, shutdownBuildServers } from './clean';

export function setup(): void {
  try {
    cleanMaterialized();
  } catch (err) {
    console.error('[e2e] global setup cleanup failed:', err);
  }
}

export async function teardown(): Promise<void> {
  try {
    await shutdownBuildServers();
    cleanMaterialized();
  } catch (err) {
    console.error('[e2e] global teardown failed:', err);
  }
}
