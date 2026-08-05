import { prebuildLibrary } from '@dotnet-wasm-bundler/fixture-builder';
import { cleanMaterialized, shutdownBuildServers } from './clean';

export async function setup(): Promise<void> {
  try {
    cleanMaterialized();
  } catch (err) {
    console.error('[e2e] global setup cleanup failed:', err);
  }
  await prebuildLibrary();
}

export async function teardown(): Promise<void> {
  try {
    await shutdownBuildServers();
    cleanMaterialized();
  } catch (err) {
    console.error('[e2e] global teardown failed:', err);
  }
}
