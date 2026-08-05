import { cleanMaterialized } from './clean';

export default function globalSetup(): void {
  try {
    cleanMaterialized();
  } catch (err) {
    console.error('[e2e] global setup cleanup failed:', err);
  }
}
