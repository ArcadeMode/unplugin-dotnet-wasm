import { prebuildLibrary } from '@dotnet-wasm-bundler/fixture-builder';
import { cleanMaterialized } from './clean';

export default async function globalSetup(): Promise<void> {
  try {
    cleanMaterialized();
  } catch (err) {
    console.error('[e2e] global setup cleanup failed:', err);
  }
  await prebuildLibrary();
}
